"use strict";
/* Raporlar modülü: BI kataloğu, geliştirme, yayın onayı, kimlik devri, kullanım. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

const draft = (o = {}) => ({
  code: "RPT-014", name: "Günlük işlem hacmi raporu", area: "Aracılık", frequency: "günlük",
  description: "Gün içi işlem hacminin ürün bazında dağılımı.",
  biPath: "araclik/gunluk-islem-hacmi", allowedRoles: [], ...o,
});

async function publish(app) {
  const pm = agentFor(app); await pm.login("tolga.firat");
  const created = await pm.post("/api/reports").send(draft());
  await pm.post(`/api/reports/${created.body.id}/publish-request`)
    .send({ reason: "Rapor testleri tamamlandı, yayına hazır." });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.kind === "report.publish");
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});
  return { id: created.body.id, pm, insp };
}

test("rapor geliştirme yetkisi olan rol taslak oluşturur, başkası oluşturamaz", async () => {
  const { app } = await boot();
  const pm = agentFor(app); await pm.login("tolga.firat");
  const ok = await pm.post("/api/reports").send(draft());
  assert.equal(ok.status, 201);

  const staff = agentFor(app); await staff.login("nazli.han");
  assert.ok([403, 404].includes((await staff.post("/api/reports").send(draft({ code: "RPT-999" }))).status));

  const bad = await pm.post("/api/reports").send(draft({ code: "kotu kod", biPath: "../../etc/passwd" }));
  assert.equal(bad.status, 400, "kod ve BI yolu doğrulanmalı");
});

test("geliştirme aşamasındaki rapor yayında değilken herkese görünmez", async () => {
  const { app } = await boot();
  const pm = agentFor(app); await pm.login("tolga.firat");   // yöneticisi: elif.yalcin
  const c = await pm.post("/api/reports").send(draft());

  const owner = (await pm.get("/api/reports")).body.items.map((x) => x.code);
  assert.ok(owner.includes("RPT-014"));

  const mgr = agentFor(app); await mgr.login("elif.yalcin");
  assert.ok((await mgr.get("/api/reports")).body.items.some((x) => x.code === "RPT-014"), "yöneticisi görür");

  const insp = agentFor(app); await insp.login("kerem.aslan");
  assert.ok((await insp.get("/api/reports")).body.items.some((x) => x.code === "RPT-014"), "Teftiş görür");

  /* Rapor okuma yetkisi olan ama ilgisiz roller: kayıt listede olmamalı. */
  for (const u of ["meltem.aydin", "gonul.aladag"]) {
    const a = agentFor(app); await a.login(u);
    assert.ok(!(await a.get("/api/reports")).body.items.some((x) => x.code === "RPT-014"), `${u} görmemeli`);
    assert.equal((await a.post(`/api/reports/${c.body.id}/open`).send({})).status, 409, "yayında olmayan rapor açılamaz");
  }
  /* Personel rolünde Raporlar modülü hiç yok. */
  const staff = agentFor(app); await staff.login("nazli.han");
  assert.equal((await staff.get("/api/reports")).status, 403, "yetkisiz rol uca erişemez");
});

test("yayın onayı Teftiş'te; onaydan sonra rapor herkese açılır", async () => {
  const { app } = await boot();
  const { id, pm } = await publish(app);

  const rep = (await pm.get("/api/reports")).body.items.find((x) => x.code === "RPT-014");
  assert.equal(rep.status, "yayinda");
  assert.equal(rep.version, 2, "yayınla birlikte sürüm artar");

  const reader = agentFor(app); await reader.login("meltem.aydin");
  assert.ok((await reader.get("/api/reports")).body.items.some((x) => x.code === "RPT-014"), "yayınlanan rapor görünür");

  const open = await reader.post(`/api/reports/${id}/open`).send({});
  assert.equal(open.status, 200);
  assert.equal(open.url, undefined);
  assert.match(open.body.url, /^https:\/\/prisma\.tera\.local\/araclik\/gunluk-islem-hacmi$/, "BI adresi katalogdan kurulur");
  assert.match(open.body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "imzalı devir anahtarı");
});

test("kimlik devri anahtarı imzalı, kısa ömürlü ve kullanıcıya bağlı", async () => {
  const { app, cfg } = await boot();
  const { id } = await publish(app);
  const reader = agentFor(app); await reader.login("meltem.aydin");
  const { body } = await reader.post(`/api/reports/${id}/open`).send({});

  const [b64, sig] = body.token.split(".");
  const payload = Buffer.from(b64, "base64url").toString("utf8");
  const [user, role, code, exp, nonce] = payload.split("|");
  assert.equal(user, "meltem.aydin");
  assert.equal(role, "opsdir");
  assert.equal(code, "RPT-014");
  assert.ok(Number(exp) - Date.now() <= 60000, "en fazla 60 saniye geçerli");
  assert.match(nonce, /^[a-f0-9]{32}$/, "tek kullanımlık nonce içerir");

  const crypto = require("crypto");
  const expect = crypto.createHmac("sha256", Buffer.from(cfg.APP_ENCRYPTION_KEY, "base64"))
    .update(payload).digest("base64url");
  assert.equal(sig, expect, "imza portalın anahtarıyla doğrulanabilir");
  const forged = crypto.createHmac("sha256", crypto.randomBytes(32)).update(payload).digest("base64url");
  assert.notEqual(sig, forged, "başka anahtarla üretilen imza tutmaz");
});

test("rol kısıtlı rapor yalnızca izin verilen role görünür", async () => {
  const { app } = await boot();
  const pm = agentFor(app); await pm.login("tolga.firat");
  const c = await pm.post("/api/reports").send(draft({ code: "RPT-022", allowedRoles: ["gmy", "inspection"] }));
  await pm.post(`/api/reports/${c.body.id}/publish-request`).send({ reason: "Yönetim raporu yayına hazır." });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.kind === "report.publish");
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});

  const gmy = agentFor(app); await gmy.login("deniz.okur");
  assert.ok((await gmy.get("/api/reports")).body.items.some((x) => x.code === "RPT-022"), "izinli rol görür");

  const reader = agentFor(app); await reader.login("meltem.aydin");
  assert.ok(!(await reader.get("/api/reports")).body.items.some((x) => x.code === "RPT-022"), "izinsiz rol görmez");
  assert.equal((await reader.post(`/api/reports/${c.body.id}/open`).send({})).status, 404, "izinsiz rol açamaz");
});

test("yayında olan rapor doğrudan değiştirilemez, emekliye alma onaya düşer", async () => {
  const { app } = await boot();
  const { id, pm, insp } = await publish(app);

  assert.equal((await pm.put(`/api/reports/${id}`).send(draft({ name: "Değiştirme denemesi raporu" }))).status, 409);
  assert.equal((await pm.del(`/api/reports/${id}`).send({})).status, 409);

  const ret = await pm.post(`/api/reports/${id}/retire-request`).send({ reason: "Yerine RPT-031 yayınlandı." });
  assert.equal(ret.status, 201);
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.kind === "report.retire");
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});
  const after = (await insp.get("/api/reports")).body.items.find((x) => x.code === "RPT-014");
  assert.equal(after.status, "emekli");
});

test("ret gerekçesi rapora yazılır ve rapor geliştirmeye döner", async () => {
  const { app } = await boot();
  const pm = agentFor(app); await pm.login("tolga.firat");
  const c = await pm.post("/api/reports").send(draft({ code: "RPT-045" }));
  await pm.post(`/api/reports/${c.body.id}/publish-request`).send({ reason: "İlk yayın talebi." });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.kind === "report.publish");
  await insp.post(`/api/approvals/${rq.id}/reject`).send({ reason: "Veri kaynağı mutabakatı eksik." });

  const after = (await pm.get("/api/reports")).body.items.find((x) => x.code === "RPT-045");
  assert.equal(after.status, "gelistirme");
  assert.match(after.reject_reason, /mutabakat/);
});

test("rapor açılışları kullanım raporunda ve denetim kaydında görünür", async () => {
  const { app, pool } = await boot();
  const { id } = await publish(app);
  const reader = agentFor(app); await reader.login("meltem.aydin");
  await reader.post(`/api/reports/${id}/open`).send({});
  await reader.post(`/api/reports/${id}/open`).send({});

  const insp = agentFor(app); await insp.login("kerem.aslan");
  const usage = (await insp.get("/api/reports/usage")).body.items.find((x) => x.code === "RPT-014");
  assert.equal(usage.opens, 2);
  assert.equal(usage.users, 1);

  const events = (await pool.query("SELECT event FROM audit_log WHERE event='rapor.acildi'")).rows;
  assert.equal(events.length, 2, "her açılış denetim kaydına yazılır");
});


test("BI devir anahtarı tek kullanımlıktır ve imzasız kabul edilmez", async () => {
  const { app } = await boot();
  const { id } = await publish(app);
  const reader = agentFor(app); await reader.login("meltem.aydin");
  const { body } = await reader.post(`/api/reports/${id}/open`).send({});

  /* BI servisinin çağıracağı uç: ilk kullanım geçerli, ikincisi reddedilir. */
  const first = await reader.post("/api/reports/sso/consume").send({ token: body.token });
  assert.equal(first.status, 200);
  assert.equal(first.body.username, "meltem.aydin");
  assert.equal(first.body.reportCode, "RPT-014");

  const replay = await reader.post("/api/reports/sso/consume").send({ token: body.token });
  assert.equal(replay.status, 409, "aynı anahtar ikinci kez kullanılamaz");

  const tampered = body.token.split(".")[0] + ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const bad = await reader.post("/api/reports/sso/consume").send({ token: tampered });
  assert.equal(bad.status, 401, "imzası bozuk anahtar reddedilir");
});

test("denetim zinciri anahtarla imzalanır; anahtarsız yeniden hesaplanamaz", async () => {
  const { app, pool, cfg } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const rows = (await pool.query("SELECT * FROM audit_log ORDER BY id LIMIT 1")).rows;
  const r = rows[0];
  const crypto = require("crypto");
  const at = r.at instanceof Date ? r.at.toISOString() : r.at;
  const detail = typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail;
  const payload = [r.prev_hash, r.event, r.actor, String(r.ok), JSON.stringify(detail || null), at].join("|");

  const plain = crypto.createHash("sha256").update(payload).digest("hex");
  assert.notEqual(r.hash, plain, "düz sha256 ile hesaplanmamalı");
  const keyed = crypto.createHmac("sha256", Buffer.from(cfg.APP_ENCRYPTION_KEY, "base64"))
    .update(payload).digest("hex");
  assert.equal(r.hash, keyed, "anahtarla imzalanmış");
});
