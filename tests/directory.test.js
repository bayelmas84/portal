"use strict";
/* Active Directory ayarları: erişim, doğrulama, sır saklama, giriş akışına etkisi. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

const SECRET = "D-" + require("crypto").randomBytes(12).toString("base64url");
const dir = (o = {}) => ({
  url: "ldaps://dc01.tera.local:636",
  baseDn: "DC=tera,DC=local",
  bindDn: "CN=svc-portal,OU=Servis,DC=tera,DC=local",
  bindPassword: SECRET,
  userFilter: "(&(objectClass=user)(sAMAccountName={username}))",
  tlsVerify: true, autoCreateUsers: false, defaultRole: "staff", active: true, ...o,
});

test("dizin ayarları ekranı yalnızca Admin'de", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const me = (await admin.get("/api/me")).body;
  const adminMod = me.modules.find((m) => m.key === "admin");
  assert.ok(adminMod.screens.some((s) => s.key === "m.dir"), "menüde Dizin (AD) ayarları var");
  assert.equal((await admin.get("/api/admin/directory")).status, 200);

  for (const u of ["kerem.aslan", "tolga.firat", "nazli.han"]) {
    const a = agentFor(app); await a.login(u);
    const res = await a.get("/api/admin/directory");
    assert.ok([403, 404, 409].includes(res.status), `${u} erişememeli → ${res.status}`);
  }
});

test("ayarlar kaydedilir; servis hesabı parolası geri dönmez ve şifreli saklanır", async () => {
  const { app, pool, cfg } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const saved = await admin.put("/api/admin/directory").send(dir());
  assert.equal(saved.status, 200);
  assert.ok(!JSON.stringify(saved.body).includes(SECRET), "parola yanıtta dönmemeli");
  assert.equal(saved.body.settings.passwordSet, true);
  assert.equal(saved.body.settings.effective.source, "veritabanı", "artık ekran ayarı geçerli");

  const row = (await pool.query("SELECT bind_password_enc FROM directory_settings WHERE id=1")).rows[0];
  assert.match(row.bind_password_enc, /^v1:/);
  assert.ok(!row.bind_password_enc.includes(SECRET), "veritabanında düz metin yok");
  const secrets = require("../server/src/lib/secrets");
  assert.equal(secrets.decrypt(row.bind_password_enc, cfg), SECRET);
});

test("geçersiz dizin ayarları reddedilir", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const cases = [
    ["adres biçimi", dir({ url: "ldaps://dc01; rm -rf /" })],
    ["base DN enjeksiyonu", dir({ baseDn: "DC=tera)(objectClass=*" })],
    ["filtrede yer tutucu yok", dir({ userFilter: "(&(objectClass=user)(sAMAccountName=admin))" })],
    ["tanımsız rol", dir({ defaultRole: "superuser" })],
  ];
  for (const [label, body] of cases)
    assert.equal((await admin.put("/api/admin/directory").send(body)).status, 400, `${label} kabul edildi`);
});

test("parola alanı boşken kayıtlı parola korunur", async () => {
  const { app, pool } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/directory").send(dir());
  const first = (await pool.query("SELECT bind_password_enc FROM directory_settings WHERE id=1")).rows[0].bind_password_enc;
  const keep = dir(); delete keep.bindPassword;
  await admin.put("/api/admin/directory").send(keep);
  const kept = (await pool.query("SELECT bind_password_enc FROM directory_settings WHERE id=1")).rows[0].bind_password_enc;
  assert.equal(kept, first);
});

test("bağlantı denemesi ve kullanıcı sorgusu sonucu kayda geçer", async () => {
  const { app, pool } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/directory").send(dir());

  /* Test ortamında gerçek AD yok: deneme başarısız olur ama kayıt tutulur. */
  const v = await admin.post("/api/admin/directory/verify").send({});
  assert.equal(v.status, 502);
  const l = await admin.post("/api/admin/directory/lookup").send({ username: "elif.yalcin" });
  assert.equal(l.status, 404);

  const events = (await pool.query("SELECT event, ok FROM audit_log WHERE event LIKE 'dizin.%'")).rows;
  assert.ok(events.some((e) => e.event === "dizin.ayarlari"));
  assert.ok(events.some((e) => e.event === "dizin.baglanti_denemesi" && e.ok === false));
  assert.ok(events.some((e) => e.event === "dizin.kullanici_sorgusu"));
  const st = (await pool.query("SELECT last_test_ok, last_test_user FROM directory_settings WHERE id=1")).rows[0];
  assert.equal(st.last_test_ok, false);
  assert.equal(st.last_test_user, "elif.yalcin");
});

test("servis hesabı parolası denetim kaydına yazılmaz", async () => {
  const { app, pool } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/directory").send(dir());
  const rows = (await pool.query("SELECT detail FROM audit_log WHERE event='dizin.ayarlari'")).rows;
  const detail = typeof rows[0].detail === "string" ? rows[0].detail : JSON.stringify(rows[0].detail);
  assert.ok(!detail.includes(SECRET), "parola kayda geçmemeli");
  assert.match(detail, /parola_degisti/);
});

test("LDAP filtresi kullanıcı adındaki özel karakterleri kaçırır", async () => {
  const ldap = require("../server/src/services/ldap");
  assert.equal(ldap.escapeFilter("a*b(c)"), "a\\2ab\\28c\\29");
  const eff = { url: "ldaps://dc:636", bindDn: "CN=x", baseDn: "DC=y", userFilter: "(sAMAccountName={username})" };
  await assert.rejects(() => ldap.authenticate("admin)(objectClass=*", "x", eff), /Geçersiz kullanıcı adı/);
  await assert.rejects(() => ldap.authenticate("gecerli.ad", "x", { url: null }), /Dizin ayarları tanımlı değil/);
});

test("hesap art arda hatalı denemede kilitlenir", async () => {
  const { app, pool, cfg } = await boot();
  const request = require("supertest");
  for (let i = 0; i < cfg.LOGIN_MAX_ATTEMPTS; i++)
    await request(app).post("/api/auth/login").send({ username: "nazli.han", password: "yanlis-" + i });

  const locked = (await pool.query("SELECT locked_until FROM users WHERE username='nazli.han'")).rows[0];
  assert.ok(locked.locked_until, "hesap kilitlenmeli");

  /* Doğru parolayla bile kilit süresince giriş yapılamaz. */
  const a = agentFor(app);
  const res = await a.login("nazli.han");
  assert.equal(res.status, 429);
  const events = (await pool.query("SELECT event FROM audit_log WHERE event='giris.hesap_kilitlendi'")).rows;
  assert.equal(events.length, 1);
});
