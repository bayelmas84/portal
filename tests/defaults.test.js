"use strict";
/* Kurulum sonrası varsayılan ekran durumları: yalnızca Admin Panel ve Proje Yönetimi açık. */
process.env.KEEP_DEFAULT_SCREEN_STATES = "1";
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

test("kurulumda yalnızca Proje Yönetimi, Admin Panel ve Kısayollar açık gelir", async () => {
  const { app, pool } = await boot();
  const rows = (await pool.query("SELECT screen_key, state FROM screen_state ORDER BY screen_key")).rows;
  const open = rows.filter((r) => r.state === "acik").map((r) => r.screen_key);
  const closed = rows.filter((r) => r.state !== "acik").map((r) => r.screen_key);

  for (const k of ["admin", "delivery", "shortcuts"])
    assert.ok(open.includes(k), `${k} varsayılanda açık olmalı`);
  for (const k of ["announce", "documents", "training", "reports", "approvals", "compliance"])
    assert.ok(closed.includes(k), `${k} varsayılanda kapalı olmalı`);
  for (const k of ["m.users", "m.avail", "d.board", "d.my", "d.charts", "d.exec", "s.all"])
    assert.ok(open.includes(k), `${k} açık olmalı`);
  for (const k of ["a.list", "k.docs", "t.un", "r.list", "p.in", "c.audit"])
    assert.ok(closed.includes(k), `${k} varsayılanda kapalı olmalı`);
});

test("kapalı modüller hiçbir rolde menüde görünmez", async () => {
  const { app } = await boot();
  for (const u of ["elif.yalcin", "kerem.aslan", "tolga.firat", "nazli.han"]) {
    const a = agentFor(app); await a.login(u);
    const me = await a.get("/api/me");
    if (me.status !== 200) continue;
    const keys = me.body.modules.map((m) => m.key);
    for (const k of ["announce", "documents", "training", "reports", "approvals", "compliance"])
      assert.ok(!keys.includes(k), `${u} için ${k} kapalıyken menüde görünmemeli`);
    const closedRes = await a.get("/api/announcements");
    assert.equal(closedRes.status, 409, "kapalı modül ucu 409 döner");
    assert.equal(closedRes.body.redirect, "home", "istemci ana sayfaya yönlendirilir");
    assert.equal(closedRes.body.state, "kapali");
  }
});

test("yönetici ihtiyaç duyduğu modülü Ekran yönetimi'nden açabilir", async () => {
  const { app } = await boot();
  const admin = agentFor(app); await admin.login("elif.yalcin");
  assert.ok(admin.get("/api/admin/screens"), "ekran yönetimi erişilebilir");

  /* Duyurular modülü ve ekranı açılır. */
  assert.equal((await admin.put("/api/admin/screens").send({ key: "announce", state: "acik" })).status, 200);
  assert.equal((await admin.put("/api/admin/screens").send({ key: "a.list", state: "acik" })).status, 200);
  assert.equal((await admin.put("/api/admin/screens").send({ key: "a.new", state: "acik" })).status, 200);

  const me = (await admin.get("/api/me")).body;
  assert.ok(me.modules.some((m) => m.key === "announce"), "açılan modül menüde görünür");
  assert.equal((await admin.get("/api/announcements")).status, 200, "açılan modülün ucu çalışır");
});
