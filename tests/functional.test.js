"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor, PASSWORD } = require("./harness");
const WRONG = "W-" + require("crypto").randomBytes(9).toString("base64url");

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 0x20), Buffer.from("\n%%EOF\n")]);
const ann = (o = {}) => ({
  title: "Test duyurusu başlığı", body: "Bu duyuru testte kullanılan yeterince uzun bir metindir.",
  category: "Genel", criticality: "Orta", validUntil: "2027-01-01", popup: false, ...o,
});

test("kimlik: doğru parola girişi açar, hatalı parola ve pasif hesap reddedilir", async () => {
  const { app } = await boot();
  const ok = agentFor(app);
  assert.equal((await ok.login("elif.yalcin")).status, 200);

  const bad = agentFor(app);
  const r1 = await bad.login("elif.yalcin", WRONG);
  assert.equal(r1.status, 401);
  assert.equal(r1.body.error, "Kullanıcı adı veya parola hatalı");

  const passive = agentFor(app);
  const r2 = await passive.login("pasif.kisi");
  assert.equal(r2.status, 401);
  assert.equal(r2.body.error, "Kullanıcı adı veya parola hatalı", "pasif hesap ayrı mesajla ele verilmemeli");
});

test("menü sunucudan gelir ve role göre farklıdır", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const staff = agentFor(app); await staff.login("nazli.han");

  const a = (await admin.get("/api/me")).body;
  const s = (await staff.get("/api/me")).body;
  const keys = (m) => m.modules.map((x) => x.key);
  assert.ok(keys(a).includes("admin"), "Admin panel yönetici menüsünde");
  assert.ok(!keys(s).includes("admin"), "Personel yönetici menüsünü görmemeli");
  assert.ok(keys(s).includes("training"), "Personel eğitim modülünü görür");
  const annMod = a.modules.find((m) => m.key === "announce");
  assert.equal(annMod.screens.find((x) => x.key === "a.list").level, "write");
  const delivery = a.modules.find((m) => m.key === "delivery");
  assert.equal(delivery.screens.find((x) => x.key === "d.board").level, "read", "Admin projede yalnızca okur");
});

test("duyuru: yasal Teftiş'e, genel yöneticiye gider; onaysız yayınlanmaz", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");

  const legal = await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));
  assert.equal(legal.status, 201);
  assert.equal(legal.body.approver, "kerem.aslan", "yasal duyuru Teftiş onayına gider");

  const general = await bg.post("/api/announcements").send(ann({ title: "Genel duyuru başlığı" }));
  assert.equal(general.body.approver, "elif.yalcin", "genel duyuru girenin yöneticisine gider");

  const other = agentFor(app); await other.login("meltem.aydin");
  const list = (await other.get("/api/announcements")).body.items;
  assert.equal(list.length, 0, "onay bekleyen duyuru başkasına görünmez");

  const insp = agentFor(app); await insp.login("kerem.aslan");
  const inspList = (await insp.get("/api/announcements")).body.items;
  assert.equal(inspList.length, 2, "Teftiş bekleyenleri görür");
});

test("duyuru: yasal kritiklik kısıtı ve zorunlu alanlar doğrulanır", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const r = await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Düşük" }));
  assert.equal(r.status, 400);
  const r2 = await bg.post("/api/announcements").send(ann({ title: "kısa" }));
  assert.equal(r2.status, 400);
});

test("onay: yalnızca onaycı karar verir, kimse kendi talebini onaylayamaz", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const created = await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));

  const mine = (await bg.get("/api/approvals/mine")).body.items;
  assert.equal(mine.length, 1);
  const reqId = mine[0].id;

  const self = await bg.post(`/api/approvals/${reqId}/approve`).send({});
  assert.equal(self.status, 403, "talep sahibi onaylayamaz");

  const wrong = agentFor(app); await wrong.login("meltem.aydin");
  assert.equal((await wrong.post(`/api/approvals/${reqId}/approve`).send({})).status, 403);

  const insp = agentFor(app); await insp.login("kerem.aslan");
  assert.equal((await insp.post(`/api/approvals/${reqId}/approve`).send({})).status, 200);

  const pub = (await wrong.get("/api/announcements")).body.items;
  assert.equal(pub.length, 1, "onaydan sonra herkes görür");
  assert.equal(pub[0].status, "yayinda");
});

test("onay: ret gerekçesi zorunlu ve kayda geçer", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const id = (await insp.get("/api/approvals/inbox")).body.items[0].id;

  assert.equal((await insp.post(`/api/approvals/${id}/reject`).send({ reason: "kısa" })).status, 400);
  const ok = await insp.post(`/api/approvals/${id}/reject`).send({ reason: "İçerik hukuk biriminden görüş bekliyor." });
  assert.equal(ok.status, 200);
  const mine = (await bg.get("/api/approvals/mine")).body.items;
  assert.equal(mine[0].status, "reddedildi");
  assert.match(mine[0].decision_reason, /hukuk/);
});

test("duyuru silme: doğrudan silinmez, gerekçeli talep açılır ve geri çekilebilir", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const pubReq = (await insp.get("/api/approvals/inbox")).body.items[0].id;
  await insp.post(`/api/approvals/${pubReq}/approve`).send({});

  const annId = (await bg.get("/api/announcements")).body.items[0].id;
  assert.equal((await bg.post(`/api/announcements/${annId}/delete-request`).send({ reason: "kısa" })).status, 400);
  const del = await bg.post(`/api/announcements/${annId}/delete-request`).send({ reason: "Yerine güncel duyuru girilecek." });
  assert.equal(del.status, 201);
  assert.equal((await bg.post(`/api/announcements/${annId}/delete-request`).send({ reason: "İkinci talep denemesi." })).status, 409);

  const still = (await bg.get("/api/announcements")).body.items.find((x) => x.id === annId);
  assert.equal(still.status, "yayinda", "onaylanana kadar duyuru yayında kalır");

  const delReq = (await bg.get("/api/approvals/mine")).body.items.find((r) => r.kind === "ann.delete");
  assert.equal((await bg.post(`/api/approvals/${delReq.id}/withdraw`).send({})).status, 200);
});

test("doküman: yalnızca gerçek PDF kabul edilir, bekleyen kayıt üçüncü kişiye görünmez", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");

  const notPdf = await bg.post("/api/documents")
    .field("docNo", "PR-TEST-001").field("title", "Test prosedürü").field("category", "Genel")
    .attach("file", Buffer.from("MZ sahte"), { filename: "x.pdf", contentType: "application/pdf" });
  assert.equal(notPdf.status, 400, "PDF imzası olmayan içerik reddedilir");

  const wrongMime = await bg.post("/api/documents")
    .field("docNo", "PR-TEST-002").field("title", "Test prosedürü").field("category", "Genel")
    .attach("file", PDF, { filename: "x.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  assert.equal(wrongMime.status, 400);

  const ok = await bg.post("/api/documents")
    .field("docNo", "PR-TEST-003").field("title", "Bilgi güvenliği prosedürü").field("category", "Genel").field("pageCount", "2")
    .attach("file", PDF, { filename: "prosedur.pdf", contentType: "application/pdf" });
  assert.equal(ok.status, 201);
  const docId = ok.body.id;

  const other = agentFor(app); await other.login("meltem.aydin");
  assert.equal((await other.get("/api/documents")).body.items.length, 0);
  assert.equal((await other.get(`/api/documents/${docId}`)).status, 404, "varlığı sızdırılmaz");

  const insp = agentFor(app); await insp.login("kerem.aslan");
  assert.equal((await insp.get("/api/documents/queue")).body.items.length, 1);
});

test("doküman: onay Teftiş'te, kaldırma talebi yalnızca yükleyende", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-TEST-010").field("title", "Kaldırma testi prosedürü").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const req = (await insp.get("/api/approvals/inbox")).body.items[0];
  await insp.post(`/api/approvals/${req.id}/approve`).send({});

  const other = agentFor(app); await other.login("meltem.aydin");
  const r = await other.post(`/api/documents/${up.body.id}/delete-request`).send({ reason: "Başkasının dokümanı için deneme." });
  assert.equal(r.status, 403, "yükleyen olmayan kaldırma talebi açamaz");

  const own = await bg.post(`/api/documents/${up.body.id}/delete-request`).send({ reason: "Prosedür yürürlükten kaldırıldı." });
  assert.equal(own.status, 201);
  const list = (await other.get("/api/documents")).body.items;
  assert.equal(list.length, 1, "talep onaylanana kadar doküman yayında kalır");
});

test("zorunlu okuma: süre sunucuda hesaplanır, erken onay reddedilir", async () => {
  const { app, cfg } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-READ-001").field("title", "Okuma testi prosedürü").field("category", "Genel").field("pageCount", "2")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const req = (await insp.get("/api/approvals/inbox")).body.items[0];
  await insp.post(`/api/approvals/${req.id}/approve`).send({});

  const staff = agentFor(app); await staff.login("nazli.han");
  const start = await staff.post(`/api/documents/${up.body.id}/reading/start`).send({});
  assert.equal(start.status, 201);
  const sid = start.body.sessionId;

  const early = await staff.post(`/api/documents/reading/${sid}/ack`).send({ seconds: 9999 });
  assert.equal(early.status, 422, "istemcinin bildirdiği süre kabul edilmez");
  assert.deepEqual(early.body.missingPages, [1, 2]);
});

test("yönetim: kendi rolünün yetkisi değiştirilemez, Admin Panel kapatılamaz", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");

  const own = await admin.put("/api/admin/permissions").send({ roleKey: "admin", screenKey: "m.users", level: "none" });
  assert.equal(own.status, 403);

  const closeAdmin = await admin.put("/api/admin/screens").send({ key: "admin", state: "kapali" });
  assert.equal(closeAdmin.status, 403);

  const closeReports = await admin.put("/api/admin/screens").send({ key: "reports", state: "kapali" });
  assert.equal(closeReports.status, 200);
  const me = (await admin.get("/api/me")).body;
  assert.ok(!me.modules.some((m) => m.key === "reports"), "kapalı modül menüden düşer");

  await admin.put("/api/admin/screens").send({ key: "training", state: "bakim" });
  const me2 = (await admin.get("/api/me")).body;
  const tr = me2.modules.find((m) => m.key === "training");
  assert.equal(tr.state, "bakim", "bakımdaki modül menüde kalır");
});

test("bildirim alıcıları tanım tablosundan gelir; kaldırma tüm personele gitmez", async () => {
  const { app, pool } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-MAIL-001").field("title", "Bildirim testi prosedürü").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const pub = (await insp.get("/api/approvals/inbox")).body.items[0];
  await insp.post(`/api/approvals/${pub.id}/approve`).send({});
  await bg.post(`/api/documents/${up.body.id}/delete-request`).send({ reason: "Yerine yenisi yayınlandı." });
  const del = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.kind === "doc.delete");
  await insp.post(`/api/approvals/${del.id}/approve`).send({});

  const mails = (await pool.query("SELECT recipient, event_key FROM mail_outbox WHERE event_key='doc.deleted'")).rows;
  const to = mails.map((m) => m.recipient);
  assert.ok(to.includes("burak.temel@terayatirim.com.tr"), "talep sahibine gider");
  assert.ok(to.includes("elif.yalcin@terayatirim.com.tr"), "yöneticisine gider");
  assert.ok(to.includes("teftis-kurulu@terayatirim.com.tr"), "Teftiş ekibine gider");
  assert.ok(!to.includes("tum-personel@terayatirim.com.tr"), "tüm personele gitmez");
});

test("denetim kaydı zinciri doğrulanır ve oynama tespit edilir", async () => {
  const { app, pool } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/announcements").send(ann({ category: "Yasal", criticality: "Kritik" }));
  const insp = agentFor(app); await insp.login("kerem.aslan");

  const ok = await insp.get("/api/admin/audit/verify");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ok, true);

  await pool.query("UPDATE audit_log SET actor='sahte.kullanici' WHERE id = (SELECT MIN(id) FROM audit_log)");
  const broken = await insp.get("/api/admin/audit/verify");
  assert.equal(broken.body.ok, false, "değiştirilen satır zinciri bozar");
});

/* --- Onay bekleyen dokümanın görünürlüğü ve yükleyenin yetkileri --- */

test("onay bekleyen doküman yalnızca yükleyene, yöneticisine ve Teftiş'e görünür", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");     // yöneticisi: elif.yalcin
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-VIS-001").field("title", "Görünürlük kuralı prosedürü").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const id = up.body.id;

  const owner = (await bg.get("/api/documents")).body.items.map((d) => d.doc_no);
  assert.ok(owner.includes("PR-VIS-001"), "yükleyen kendi kaydını görür");

  const mgr = agentFor(app); await mgr.login("elif.yalcin");   // Admin ama aynı zamanda yöneticisi
  const mgrList = (await mgr.get("/api/documents")).body.items.map((d) => d.doc_no);
  assert.ok(mgrList.includes("PR-VIS-001"), "yükleyenin yöneticisi görür");

  const insp = agentFor(app); await insp.login("kerem.aslan");
  assert.ok((await insp.get("/api/documents")).body.items.some((d) => d.doc_no === "PR-VIS-001"), "Teftiş görür");

  for (const u of ["meltem.aydin", "gonul.aladag", "tolga.firat", "deniz.okur"]) {
    const other = agentFor(app); await other.login(u);
    const list = (await other.get("/api/documents")).body.items.map((d) => d.doc_no);
    assert.ok(!list.includes("PR-VIS-001"), `${u} onay bekleyen dokümanı görmemeli`);
    assert.equal((await other.get(`/api/documents/${id}`)).status, 404, `${u} kaydı açamamalı`);
    assert.equal((await other.get(`/api/documents/${id}/file`)).status, 404, `${u} dosyayı açamamalı`);
  }
});

test("Teftiş kuyruğunu yalnızca Teftiş görür; Admin'e kapalı", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const me = (await admin.get("/api/me")).body;
  const docsMod = me.modules.find((m) => m.key === "documents");
  assert.ok(!docsMod.screens.some((s) => s.key === "k.queue"), "Admin menüsünde Teftiş kuyruğu olmamalı");
  const res = await admin.get("/api/documents/queue");
  assert.ok([403, 404].includes(res.status), `Admin kuyruğa erişememeli → ${res.status}`);

  const insp = agentFor(app); await insp.login("kerem.aslan");
  assert.equal((await insp.get("/api/documents/queue")).status, 200);
});

test("onaydan sonra doküman herkese görünür", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/documents")
    .field("docNo", "PR-VIS-002").field("title", "Yayın sonrası görünürlük").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.subject.includes("PR-VIS-002"));
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});

  for (const u of ["meltem.aydin", "nazli.han", "tolga.firat"]) {
    const other = agentFor(app); await other.login(u);
    const list = (await other.get("/api/documents")).body.items.map((d) => d.doc_no);
    assert.ok(list.includes("PR-VIS-002"), `${u} yayınlanan dokümanı görmeli`);
  }
});

test("doküman onayı ve reddi yalnızca Teftiş rolünde", async () => {
  const { app, pool } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/documents")
    .field("docNo", "PR-ROLE-001").field("title", "Onay rolü denemesi").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const reqId = (await bg.get("/api/approvals/mine")).body.items[0].id;

  /* Talep Teftiş'e düşer; onaycı alanı elle Admin'e çevrilse bile rol kontrolü engeller. */
  await pool.query("UPDATE requests SET approver='elif.yalcin' WHERE id=$1", [reqId]);
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const ap = await admin.post(`/api/approvals/${reqId}/approve`).send({});
  assert.equal(ap.status, 403);
  assert.match(ap.body.error, /Teftiş/);
  const rj = await admin.post(`/api/approvals/${reqId}/reject`).send({ reason: "Deneme gerekçesi yeterince uzun." });
  assert.equal(rj.status, 403);
});

test("yükleyen onay öncesi dosyayı değiştirebilir ve kaydı silebilir", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-EDIT-001").field("title", "Değiştirme ve silme denemesi").field("category", "Genel")
    .attach("file", PDF, { filename: "ilk.pdf", contentType: "application/pdf" });
  const id = up.body.id;

  /* Dosya değişimi: sürüm artmaz, kayıt onayda kalır. */
  const NEWPDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 0x41)]);
  const put = await bg.put(`/api/documents/${id}/file`)
    .attach("file", NEWPDF, { filename: "duzeltilmis.pdf", contentType: "application/pdf" });
  assert.equal(put.status, 200);
  const after = (await bg.get(`/api/documents/${id}`)).body.item;
  assert.equal(after.version, "1.0", "sürüm artmamalı");
  assert.equal(after.status, "onayda");
  assert.equal(after.file_name, "duzeltilmis.pdf");

  /* Başkası değiştiremez. */
  const other = agentFor(app); await other.login("kerem.aslan");
  const forbidden = await other.put(`/api/documents/${id}/file`)
    .attach("file", NEWPDF, { filename: "x.pdf", contentType: "application/pdf" });
  assert.equal(forbidden.status, 403);

  /* Yükleyen onay öncesi kaydı siler; bekleyen talep de düşer. */
  const del = await bg.del(`/api/documents/${id}`).send({});
  assert.equal(del.status, 200);
  assert.equal((await bg.get(`/api/documents/${id}`)).status, 404);
  const mine = (await bg.get("/api/approvals/mine")).body.items.find((r) => r.subject.includes("PR-EDIT-001"));
  assert.equal(mine.status, "geri_cekildi");
});

test("yayında olan dokümanda doğrudan silme ve dosya değişimi kapalı", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", "PR-EDIT-002").field("title", "Yayın sonrası kısıt").field("category", "Genel")
    .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.subject.includes("PR-EDIT-002"));
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});

  const del = await bg.del(`/api/documents/${up.body.id}`).send({});
  assert.equal(del.status, 409);
  assert.match(del.body.error, /kaldırma talebi/);
  const put = await bg.put(`/api/documents/${up.body.id}/file`)
    .attach("file", PDF, { filename: "p2.pdf", contentType: "application/pdf" });
  assert.equal(put.status, 409);
});
