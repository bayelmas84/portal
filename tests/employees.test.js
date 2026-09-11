"use strict";
/* Çalışanlar (Kişi Rehberi): herkesin okuyabildiği, gerçek users/units/titles
   tablolarından beslenen salt-okunur dizin. Hassas alan (parola vb.) döndürülmemeli. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor, PASSWORD } = require("./harness");

test("her aktif kullanıcı Çalışanlar dizinini okuyabilir", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const user = agentFor(app);
  await user.login("tolga.firat", PASSWORD);
  const r = await user.get("/api/employees");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.items) && r.body.items.length > 0, "en az bir çalışan dönmeli");
  const rec = r.body.items.find((x) => x.username === "bayram.elmas");
  assert.ok(rec, "bilinen bir kullanıcı listede olmalı");
  assert.equal(rec.display_name, "Bayram Elmas");
  assert.ok(rec.unit_name, "birim adı join edilmiş olmalı (kod değil)");
  assert.ok(rec.title_name, "unvan adı join edilmiş olmalı (kod değil)");
  assert.ok(!("password" in rec) && !("password_hash" in rec), "hassas alan döndürülmemeli");
});

test("pasif kullanıcı Çalışanlar dizininde görünmez", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const user = agentFor(app);
  await user.login("tolga.firat", PASSWORD);
  const r = await user.get("/api/employees");
  const pasif = r.body.items.find((x) => x.username === "pasif.kisi");
  assert.equal(pasif, undefined, "active=false olan kullanıcı listelenmemeli");
});

test("girişsiz istek Çalışanlar dizinine erişemez", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const r = await require("supertest")(app).get("/api/employees");
  assert.equal(r.status, 401);
});

test("/me artık gerçek birim ve unvan adını döndürür (kod değil)", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const user = agentFor(app);
  await user.login("tolga.firat", PASSWORD);
  const me = await user.get("/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.user.unit, "BT");
  assert.ok(me.body.user.unitName && me.body.user.unitName !== "BT", "unitName kod değil, gerçek isim olmalı");
  assert.ok(me.body.user.titleName, "titleName dolu olmalı");
});

test("Çalışanlar ekranı client bundle'ında gerçek liste/filtre içerir", async (t) => {
  const { app, pool } = await boot();
  t.after(() => pool.end());
  const js = (await require("supertest")(app).get("/app.js")).text;
  assert.match(js, /employeesView/, "employeesView fonksiyonu bundle'da olmalı");
  assert.match(js, /\/employees/, "istemci gerçek /employees ucunu çağırmalı");
  assert.match(js, /empFilterInput/, "canlı filtre girişi olmalı");
});
