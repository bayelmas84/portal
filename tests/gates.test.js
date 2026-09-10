"use strict";
/* Faz kapısı: iki imza kuralı ve Proje Yönetim Direktörü'nün tek imzayla ilerletme yetkisi. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

const CRIT = JSON.stringify([
  { text: "Kod incelemeleri kapandı", done: false },
  { text: "Birim test kapsamı %80", done: false },
  { text: "Devreye alma planı onaylı", done: false },
]);

async function seedGate(pool) {
  const pid = (await pool.query(
    `INSERT INTO projects (code,name,method,lead,unit_code,status,health)
     VALUES ('CORE','Portföy sistemi göçü','Waterfall','tolga.firat','BT','devam','risk') RETURNING id`)).rows[0].id;
  const gid = (await pool.query(
    `INSERT INTO stage_gates (project_id,name,criteria,required_signatures)
     VALUES ($1,'Geliştirme → Test',$2::jsonb,2) RETURNING id`, [pid, CRIT])).rows[0].id;
  return { pid, gid };
}
async function closeAllCriteria(agent, gid) {
  for (let i = 0; i < 3; i++) await agent.put(`/api/gates/${gid}/criteria/${i}`).send({ done: true });
}

test("açık kriter varken kapı imzalanamaz", async () => {
  const { app, pool } = await boot();
  const { gid } = await seedGate(pool);
  const pm = agentFor(app); await pm.login("tolga.firat");
  const res = await pm.post(`/api/gates/${gid}/sign`).send({});
  assert.equal(res.status, 422);
  assert.equal(res.body.openCriteria, 3);
});

test("kriterler kapanınca iki farklı kişi ve iki farklı rol imzalar", async () => {
  const { app, pool } = await boot();
  const { pid, gid } = await seedGate(pool);
  const pm = agentFor(app); await pm.login("tolga.firat");
  await closeAllCriteria(pm, gid);

  const first = await pm.post(`/api/gates/${gid}/sign`).send({});
  assert.equal(first.status, 200);
  assert.equal(first.body.passed, false, "tek imza yetmez");

  const again = await pm.post(`/api/gates/${gid}/sign`).send({});
  assert.equal(again.status, 409, "aynı kişi ikinci imzayı atamaz");

  /* İkinci imza farklı bir rolden gelir: GMY kademesi. */
  const gmy = agentFor(app); await gmy.login("deniz.okur");
  const second = await gmy.post(`/api/gates/${gid}/sign`).send({});
  assert.equal(second.status, 200);
  assert.equal(second.body.passed, true, "iki farklı rol ile kapı geçildi");
  assert.equal(second.body.item.signatures.length, 2);
});

test("Proje Yönetim Direktörü kendi işaretlediği kriterlerden sonra tek imzayla ilerletebilir", async () => {
  const { app, pool } = await boot();
  const { gid } = await seedGate(pool);
  const bayram = agentFor(app); await bayram.login("bayram.elmas");

  /* Kriterleri kendisi işaretler. */
  await closeAllCriteria(bayram, gid);
  const view = await bayram.get(`/api/gates/project/${(await pool.query("SELECT project_id FROM stage_gates WHERE id=$1", [gid])).rows[0].project_id}`);
  assert.equal(view.body.canOverride, true, "override yetkisi bildirilir");
  assert.equal(view.body.items[0].openCriteria, 0);

  /* Gerekçesiz override reddedilir. */
  const noReason = await bayram.post(`/api/gates/${gid}/sign`).send({ override: true });
  assert.equal(noReason.status, 400);

  const ok = await bayram.post(`/api/gates/${gid}/sign`)
    .send({ override: true, reason: "Test fazı kaynakları hazır; kapı yönetim kararıyla ilerletildi." });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.passed, true, "tek imzayla geçti");
  assert.equal(ok.body.item.override.by, "bayram.elmas");
  assert.match(ok.body.item.override.reason, /yönetim kararıyla/);
});

test("override yetkisi olmayan rol tek imzayla ilerletemez", async () => {
  const { app, pool } = await boot();
  const { gid } = await seedGate(pool);
  const pm = agentFor(app); await pm.login("tolga.firat");
  await closeAllCriteria(pm, gid);
  const res = await pm.post(`/api/gates/${gid}/sign`)
    .send({ override: true, reason: "Kendi başıma ilerletmek istiyorum." });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Proje Yönetim Direktörü/);
});

test("override denetim kaydına ayrı olay ve gerekçesiyle yazılır", async () => {
  const { app, pool } = await boot();
  const { gid } = await seedGate(pool);
  const bayram = agentFor(app); await bayram.login("bayram.elmas");
  await closeAllCriteria(bayram, gid);
  await bayram.post(`/api/gates/${gid}/sign`)
    .send({ override: true, reason: "Kapsam daraltıldı, kalan işler sonraki faza taşındı." });

  const rows = (await pool.query(
    "SELECT event, actor, ok, detail FROM audit_log WHERE event = 'faz_kapisi.tek_imza_override'")).rows;
  assert.equal(rows.length, 1, "override ayrı bir olay olarak kayda geçer");
  assert.equal(rows[0].actor, "bayram.elmas");
  assert.equal(rows[0].ok, false, "olağan akıştan sapma olarak işaretlenir");
  const detail = typeof rows[0].detail === "string" ? rows[0].detail : JSON.stringify(rows[0].detail);
  assert.match(detail, /Kapsam daraltıldı/, "gerekçe kayda geçer");

  const crit = (await pool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE event='faz_kapisi.kriter'")).rows[0].n;
  assert.equal(crit, 3, "kriter işaretlemeleri de kayıtlı");
});

test("geçilmiş kapıda kriter değiştirilemez ve yeniden imzalanamaz", async () => {
  const { app, pool } = await boot();
  const { gid } = await seedGate(pool);
  const bayram = agentFor(app); await bayram.login("bayram.elmas");
  await closeAllCriteria(bayram, gid);
  await bayram.post(`/api/gates/${gid}/sign`).send({ override: true, reason: "Yönetim kararıyla ilerletildi." });

  assert.equal((await bayram.put(`/api/gates/${gid}/criteria/0`).send({ done: false })).status, 409);
  assert.equal((await bayram.post(`/api/gates/${gid}/sign`).send({})).status, 409);
});

test("Bayram Elmas Proje Yönetimi'nde tam yetkili, Admin Panel'de salt okunur", async () => {
  const { app } = await boot();
  const a = agentFor(app); await a.login("bayram.elmas");
  const me = (await a.get("/api/me")).body;

  const delivery = me.modules.find((m) => m.key === "delivery");
  assert.ok(delivery, "Proje Yönetimi menüde");
  for (const k of ["d.my", "d.projects", "d.board", "d.backlog", "d.sprint", "d.gate", "d.charts", "d.exec"]) {
    const sc = delivery.screens.find((x) => x.key === k);
    assert.ok(sc, `${k} ekranı görünmeli`);
    assert.equal(sc.level, "write", `${k} yazma yetkisi olmalı`);
  }
  /* Admin Panel'in tamamını görür ama hiçbir ekranında değişiklik yapamaz. */
  const admin = me.modules.find((m) => m.key === "admin");
  assert.ok(admin, "Admin Panel menüde görünür");
  assert.ok(admin.screens.length >= 10, `admin ekranlarının tamamı görünür (${admin.screens.length})`);
  for (const sc of admin.screens)
    assert.equal(sc.level, "read", `${sc.key} salt okunur olmalı`);

  /* Yazma denemeleri reddedilir. */
  assert.equal((await a.put("/api/admin/screens").send({ key: "announce", state: "acik" })).status, 403);
  assert.equal((await a.post("/api/admin/users").send({
    username: "deneme.kullanici", displayName: "Deneme", roleKey: "staff", unitCode: "BT", titleCode: "UZM",
  })).status, 403);
  assert.equal((await a.get("/api/admin/directory")).status, 200, "okuma açık");
});

test("Bayram Elmas yönetici özetini görebilir (PYD ünvanı)", async () => {
  const { app, pool } = await boot();
  await seedGate(pool);
  const a = agentFor(app); await a.login("bayram.elmas");
  const res = await a.get("/api/projects/reports/executive");
  assert.equal(res.status, 200);
  assert.ok(res.body.totals.projects >= 1);
});

test("yöneticisi olmayan kişinin genel duyurusu Teftiş onayına düşer", async () => {
  const { app, pool } = await boot();
  /* Duyuru girme yetkisi olan bir kullanıcının yöneticisi kaldırılır
     (Proje Yönetim Direktörü duyuru girmez; yetkisi yalnızca Proje Yönetimi'ndedir). */
  await pool.query("UPDATE users SET manager = NULL WHERE username = 'burak.temel'");
  const a = agentFor(app); await a.login("burak.temel");
  const res = await a.post("/api/announcements").send({
    title: "Proje yönetimi süreç değişikliği", body: "Faz kapısı kriterleri güncellenmiştir.",
    category: "Genel", criticality: "Orta", validUntil: "2027-01-01", popup: false });
  assert.equal(res.status, 201);
  assert.equal(res.body.approver, "kerem.aslan", "yöneticisi yoksa Teftiş onaylar");

  /* Kendi talebini onaylayamaz. */
  const reqId = (await a.get("/api/approvals/mine")).body.items[0].id;
  assert.equal((await a.post(`/api/approvals/${reqId}/approve`).send({})).status, 403);
});

test("bekleyen silme talebi yalnızca taraflarına görünür; Admin göremez", async () => {
  const { app, pool } = await boot();
  /* Burak Temel duyuru girer, Teftiş yayınlar, sonra Burak silme talebi açar. */
  const bg = agentFor(app); await bg.login("burak.temel");
  const created = await bg.post("/api/announcements").send({
    title: "Silme talebi görünürlük denemesi", body: "Bu duyuru silme talebi akışını sınamak içindir.",
    category: "Yasal", criticality: "Kritik", validUntil: "2027-01-01", popup: false });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const inbox1 = (await insp.get("/api/approvals/inbox")).body.items;
  const pub = inbox1.find((r) => r.subject.includes("Silme talebi görünürlük"));
  await insp.post(`/api/approvals/${pub.id}/approve`).send({});

  const del = await bg.post(`/api/announcements/${created.body.id}/delete-request`)
    .send({ reason: "Mevzuat değişikliği nedeniyle geçersiz kaldı." });
  assert.equal(del.status, 201);

  const seen = (agent) => agent.get("/api/announcements")
    .then((r) => r.body.items.find((x) => x.id === created.body.id));

  /* Talebi giren ve Teftiş görür. */
  assert.equal((await seen(bg)).pending_delete, true, "talebi giren görür");
  assert.equal((await seen(insp)).pending_delete, true, "Teftiş görür");

  /* Admin duyuruyu görür ama bekleyen talebi görmez. */
  const admin = agentFor(app); await admin.login("gonul.aladag");
  const row = await seen(admin);
  assert.ok(row, "yayınlanmış duyuru görünür");
  assert.equal(row.pending_delete, false, "bekleyen silme talebi görünmez");
});

test("silme talebini yalnızca duyuruyu giren veya Teftiş açabilir", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const created = await bg.post("/api/announcements").send({
    title: "Talep sahipliği denemesi", body: "Silme talebini kim açabilir sınaması.",
    category: "Yasal", criticality: "Kritik", validUntil: "2027-01-01", popup: false });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const pub = (await insp.get("/api/approvals/inbox")).body.items
    .find((r) => r.subject.includes("Talep sahipliği"));
  await insp.post(`/api/approvals/${pub.id}/approve`).send({});

  /* Başkasının duyurusu için talep açılamaz. */
  const other = agentFor(app); await other.login("gonul.aladag");
  const res = await other.post(`/api/announcements/${created.body.id}/delete-request`)
    .send({ reason: "Bu talebi açma yetkim olmamalı." });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /duyuruyu giren kişi veya Teftiş/);

  /* Admin'e bu yetki hiç verilmemiştir. */
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const adminRes = await admin.post(`/api/announcements/${created.body.id}/delete-request`)
    .send({ reason: "Admin bu talebi açamamalı." });
  assert.ok([403, 404].includes(adminRes.status), `Admin engellenmeli → ${adminRes.status}`);
});
