"use strict";
/* Admin Panel'den yönetilen e-posta ayarları: erişim, sır saklama, doğrulama, kuyruk. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

/* Sınanan sır çalışma anında üretilir; kaynak dosyada sabit kimlik bilgisi yok. */
const SECRET = "S-" + require("crypto").randomBytes(12).toString("base64url");

const settings = (o = {}) => ({
  host: "smtp.tera.local", port: 587, encryption: "starttls",
  authUser: "svc-portal", password: SECRET,
  fromAddress: "portal@terayatirim.com.tr", replyTo: "",
  mailDomain: "terayatirim.com.tr",
  groupInspection: "teftis-kurulu@terayatirim.com.tr",
  groupAll: "tum-personel@terayatirim.com.tr",
  active: true, ...o,
});

test("e-posta ayarları ekranı yalnızca Admin'de", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const me = (await admin.get("/api/me")).body;
  const adminMod = me.modules.find((m) => m.key === "admin");
  assert.ok(adminMod.screens.some((s) => s.key === "m.mail"), "Admin menüsünde E-posta ayarları var");
  assert.equal((await admin.get("/api/admin/mail")).status, 200);

  for (const u of ["kerem.aslan", "gonul.aladag", "tolga.firat", "nazli.han"]) {
    const a = agentFor(app); await a.login(u);
    const res = await a.get("/api/admin/mail");
    assert.ok([403, 404].includes(res.status), `${u} erişememeli → ${res.status}`);
    const w = await a.put("/api/admin/mail").send(settings());
    assert.ok([403, 404].includes(w.status), `${u} değiştirememeli → ${w.status}`);
  }
});

test("ayarlar kaydedilir; parola hiçbir uçtan geri dönmez", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const saved = await admin.put("/api/admin/mail").send(settings());
  assert.equal(saved.status, 200);

  const body = JSON.stringify(saved.body);
  assert.ok(!body.includes(SECRET), "parola yanıtta dönmemeli");
  assert.equal(saved.body.settings.passwordSet, true, "parolanın tanımlı olduğu bildirilir");
  assert.equal(saved.body.settings.host, "smtp.tera.local");
  assert.equal(saved.body.settings.authUser, "svc-portal");

  const read = await admin.get("/api/admin/mail");
  assert.ok(!JSON.stringify(read.body).includes(SECRET));
  assert.equal(read.body.settings.effective.source, "veritabanı", "artık .env değil ekran ayarı geçerli");
});

test("parola veritabanında şifreli saklanır ve düz metin bulunmaz", async () => {
  const { app, pool, cfg } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/mail").send(settings());

  const row = (await pool.query("SELECT auth_pass_enc FROM mail_settings WHERE id=1")).rows[0];
  assert.ok(row.auth_pass_enc, "parola kaydedilmeli");
  assert.ok(!row.auth_pass_enc.includes(SECRET), "veritabanında düz metin olmamalı");
  assert.match(row.auth_pass_enc, /^v1:/, "AES-GCM zarf biçimi");

  const secrets = require("../server/src/lib/secrets");
  assert.equal(secrets.decrypt(row.auth_pass_enc, cfg), SECRET, "doğru anahtarla çözülür");
  const other = { APP_ENCRYPTION_KEY: require("crypto").randomBytes(32).toString("base64") };
  assert.throws(() => secrets.decrypt(row.auth_pass_enc, other), "farklı anahtarla çözülmemeli");
});

test("parola alanı boş bırakılırsa mevcut parola korunur, \"\" gönderilirse silinir", async () => {
  const { app, pool } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/mail").send(settings());
  const first = (await pool.query("SELECT auth_pass_enc FROM mail_settings WHERE id=1")).rows[0].auth_pass_enc;

  const keep = settings(); delete keep.password;
  await admin.put("/api/admin/mail").send(keep);
  const kept = (await pool.query("SELECT auth_pass_enc FROM mail_settings WHERE id=1")).rows[0].auth_pass_enc;
  assert.equal(kept, first, "parola alanı boşken kayıt korunur");

  await admin.put("/api/admin/mail").send(settings({ password: "" }));
  const cleared = (await pool.query("SELECT auth_pass_enc FROM mail_settings WHERE id=1")).rows[0].auth_pass_enc;
  assert.equal(cleared, null, "boş dize parolayı siler");
});

test("geçersiz ayarlar reddedilir", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const cases = [
    ["sunucu adında komut kaçışı", settings({ host: "smtp.tera.local; rm -rf /" })],
    ["geçersiz port", settings({ port: 99999 })],
    ["geçersiz şifreleme", settings({ encryption: "sslv3" })],
    ["geçersiz gönderen adresi", settings({ fromAddress: "portal-at-tera" })],
    ["geçersiz grup adresi", settings({ groupAll: "hepsi" })],
    ["sunucu yokken etkinleştirme", settings({ host: "", active: true })],
  ];
  for (const [label, body] of cases) {
    const res = await admin.put("/api/admin/mail").send(body);
    assert.equal(res.status, 400, `${label} kabul edildi`);
  }
});

test("bağlantı ve deneme gönderimi tanımsız sunucuda hata döner, kayda geçer", async () => {
  const { app, pool } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");

  const v = await admin.post("/api/admin/mail/verify").send({});
  assert.equal(v.status, 502);
  assert.equal(v.body.ok, false);

  const t = await admin.post("/api/admin/mail/test").send({});
  assert.equal(t.status, 502);

  const events = (await pool.query("SELECT event, ok FROM audit_log WHERE event LIKE 'eposta.%'")).rows;
  assert.ok(events.some((e) => e.event === "eposta.baglanti_denemesi" && e.ok === false));
  assert.ok(events.some((e) => e.event === "eposta.deneme_gonderimi" && e.ok === false));

  const last = (await pool.query("SELECT last_test_ok, last_test_error FROM mail_settings WHERE id=1")).rows[0];
  assert.equal(last.last_test_ok, false);
  assert.ok(last.last_test_error, "hata metni ekranda gösterilmek üzere saklanır");
});

test("parola denetim kaydına yazılmaz", async () => {
  const { app, pool } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/mail").send(settings());
  const rows = (await pool.query("SELECT detail FROM audit_log WHERE event='eposta.ayarlari'")).rows;
  assert.equal(rows.length, 1);
  const detail = typeof rows[0].detail === "string" ? rows[0].detail : JSON.stringify(rows[0].detail);
  assert.ok(!detail.includes(SECRET), "denetim kaydında parola olmamalı");
  assert.match(detail, /parola_degisti/, "yalnızca değişip değişmediği yazılır");
});

test("bildirim grup adresleri ekran ayarından gelir", async () => {
  const { app, pool, cfg } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/mail").send(settings({
    groupInspection: "denetim@terayatirim.com.tr", groupAll: "herkes@terayatirim.com.tr" }));
  await pool.query("DELETE FROM mail_outbox");

  const notify = require("../server/src/services/notify");
  const to = await notify.send("doc.approve", { subject: "deneme", requester: "burak.temel", approver: "kerem.aslan" }, cfg, "test");
  assert.ok(to.includes("denetim@terayatirim.com.tr"), "Teftiş grubu ekrandan geldi");
  assert.ok(to.includes("herkes@terayatirim.com.tr"), "tüm personel grubu ekrandan geldi");
  assert.ok(!to.includes("teftis-kurulu@terayatirim.com.tr"), ".env değeri artık kullanılmıyor");
});

test("kuyruk elle boşaltılabilir ve durum ekranda görünür", async () => {
  const { app } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/announcements").send({
    title: "Kuyruk durumu duyurusu", body: "Kuyruk ekranını sınayan yeterince uzun metin.",
    category: "Yasal", criticality: "Kritik", validUntil: "2027-01-01", popup: false });

  const admin = agentFor(app); await admin.login("elif.yalcin");
  const view = await admin.get("/api/admin/mail");
  assert.ok(view.body.queue.pending > 0, "bekleyen posta sayısı ekranda");

  const flush = await admin.post("/api/admin/mail/flush").send({});
  assert.equal(flush.status, 200);
  assert.equal(flush.body.sent, 0, "SMTP tanımsız olduğu için gönderim olmaz");
  assert.ok(flush.body.pending > 0, "postalar kuyrukta kalır");
});
