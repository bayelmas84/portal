"use strict";
/* Marka ve metinler: parametrik değerler, yetki ve doğrulama. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

const brand = (o = {}) => ({
  company: "Deneme Holding A.Ş.", companyShort: "Deneme", product: "Deneme Merkez",
  productMark: "MRKZ", slogan: "Tüm işleriniz aynı çatı altında.",
  loginTitle: "Oturum açın", loginHint: "Kurum hesabınızla devam edin.",
  footer: "© 2026 Deneme Holding A.Ş.", signature: "powered by bayelmas",
  accent: "#0F6E56", ...o,
});

test("marka ayarları Admin'de değiştirilir, herkes okur", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  const me = (await admin.get("/api/me")).body;
  const adminMod = me.modules.find((m) => m.key === "admin");
  assert.ok(adminMod.screens.some((s) => s.key === "m.brand"), "menüde Marka ve metinler var");

  const saved = await admin.put("/api/admin/brand").send(brand());
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.product, "Deneme Merkez");

  /* Marka ucu oturum açmış her kullanıcıya açıktır: ekranlar bu değerleri kullanır. */
  const staff = agentFor(app); await staff.login("nazli.han");
  const b = (await staff.get("/api/brand")).body.brand;
  assert.equal(b.company, "Deneme Holding A.Ş.");
  assert.equal(b.productMark, "MRKZ");
  assert.equal(b.slogan, "Tüm işleriniz aynı çatı altında.");

  /* Personel değiştiremez. */
  const w = await staff.put("/api/admin/brand").send(brand({ product: "Zorla" }));
  assert.ok([403, 404, 409].includes(w.status), `personel değiştirememeli → ${w.status}`);
});

test("geçersiz marka değerleri reddedilir", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  for (const [label, body] of [
    ["boş şirket adı", brand({ company: "" })],
    ["geçersiz renk", brand({ accent: "kırmızı" })],
    ["aşırı uzun kısaltma", brand({ productMark: "ÇOKUZUNKISALTMA" })],
    ["boş slogan", brand({ slogan: "x" })],
  ]) assert.equal((await admin.put("/api/admin/brand").send(body)).status, 400, `${label} kabul edildi`);
});

test("marka ayarı yokken varsayılanlar kullanılır", async () => {
  const { app } = await boot();
  const a = agentFor(app); await a.login("nazli.han");
  const b = (await a.get("/api/brand")).body.brand;
  assert.deepEqual(b, {}, "kayıt boşken sunucu boş döner, istemci varsayılana düşer");
  const js = (await require("supertest")(app).get("/app.js")).text;
  assert.match(js, /BRAND_DEFAULTS/, "istemcide varsayılanlar tanımlı");
  /* Slogan ve logo artık hero görselinin içinde; giriş ekranındaki metinler parametrik. */
  assert.match(js, /\$\{esc\(BRAND\.loginTitle\)\}/, "giriş başlığı parametreden geliyor");
  assert.match(js, /\$\{esc\(BRAND\.loginHint\)\}/, "giriş açıklaması parametreden geliyor");
  assert.match(js, /\$\{esc\(BRAND\.footer\)\}/, "alt bilgi parametreden geliyor");
  assert.match(js, /\$\{esc\(BRAND\.slogan\)\}/, "slogan alt metninde parametreden geliyor");
});

test("marka değişikliği denetim kaydına yazılır", async () => {
  const { app, pool } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  await admin.put("/api/admin/brand").send(brand());
  const rows = (await pool.query("SELECT actor, detail FROM audit_log WHERE event='marka.guncellendi'")).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor, "elif.yalcin");
});

test("Proje Yönetim Direktörü marka ekranını görür ama değiştiremez", async () => {
  const { app } = await boot();
  const dir = agentFor(app); await dir.login("bayram.elmas");
  assert.equal((await dir.get("/api/admin/brand")).status, 200, "okuma açık");
  assert.equal((await dir.put("/api/admin/brand").send(brand())).status, 403, "yazma kapalı");
});
