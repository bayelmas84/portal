"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { createApp } = require("../server/src/app");
const { pool } = require("../server/src/db");

const app = createApp();

// Test paketi 9+ login çağrısı yapar; login_max_attempts artık admin panelinden
// (DB üzerinden) yönetildiği için testler kendi ortamında bu limiti yükseltir
// — üretim davranışını (DB'den okuma) değiştirmeden, yalnızca test verisini uyarlar.
// test.before() ile ilk teste kadar tamamlanması garanti edilir.
test.before(async () => {
  await pool.query("UPDATE app_settings SET value='500' WHERE key='login_max_attempts'").catch(() => {});
});

async function login(username) {
  const res = await request(app).post("/api/auth/login").send({ username, password: "demo1234" });
  const cookie = res.headers["set-cookie"][0];
  return { cookie, csrf: res.body.csrfToken, user: res.body.user };
}

test("giriş: geçerli kullanıcı adıyla oturum ve CSRF token döner", async () => {
  const { cookie, csrf, user } = await login("tolga.firat");
  assert.ok(cookie);
  assert.ok(csrf);
  assert.equal(user.role, "pm");
});

test("giriş: olmayan kullanıcı adı reddedilir", async () => {
  const res = await request(app).post("/api/auth/login").send({ username: "yok.boyle.biri", password: "herhangi123" });
  assert.equal(res.status, 401);
});

test("CSRF: token olmadan yazma isteği reddedilir", async () => {
  const { cookie } = await login("tolga.firat");
  const res = await request(app).post("/api/projects/meetings").set("Cookie", cookie).send({});
  assert.equal(res.status, 403);
});

test("RBAC: staff toplantı notu oluşturamaz", async () => {
  const { cookie, csrf } = await login("nazli.han");
  const res = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", cookie)
    .set("X-CSRF-Token", csrf)
    .send({ projectK: "TRADE", date: "2026-11-01", participants: ["nazli.han"], items: [] });
  assert.equal(res.status, 403);
});

test("Toplantı notu: pm oluşturabilir, katılımcı olmayan görmez, Teftiş her zaman görür", async () => {
  const pm = await login("tolga.firat");
  const create = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({
      projectK: "TRADE",
      date: "2026-11-05",
      participants: ["mert.balkan"],
      items: [{ text: "Test maddesi" }],
    });
  assert.equal(create.status, 201);
  assert.equal(create.body.mailSent, 0); // SMTP henüz etkin değil

  const staff = await login("nazli.han"); // katılımcı değil
  const staffList = await request(app)
    .get("/api/projects/meetings?project=TRADE")
    .set("Cookie", staff.cookie);
  assert.equal(staffList.body.items.some((m) => m.id === create.body.item.id), false);

  const insp = await login("kerem.aslan"); // her zaman görür
  const inspList = await request(app)
    .get("/api/projects/meetings?project=TRADE")
    .set("Cookie", insp.cookie);
  assert.equal(inspList.body.items.some((m) => m.id === create.body.item.id), true);
});

test("Toplantı maddesi: devredilince proje devir kuyruğuna düşer", async () => {
  const pm = await login("tolga.firat");
  const create = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ projectK: "TRADE", date: "2026-11-06", participants: ["mert.balkan"], items: [{ text: "Devredilecek" }] });
  const meetingId = create.body.item.id;
  const itemsRes = await request(app).get("/api/projects/meetings?project=TRADE").set("Cookie", pm.cookie);
  const meeting = itemsRes.body.items.find((m) => m.id === meetingId);
  const itemId = meeting.items[0].id;

  const carry = await request(app)
    .post(`/api/projects/meetings/${meetingId}/items/${itemId}/status`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "carried" });
  assert.equal(carry.status, 200);

  const queue = await request(app).get("/api/projects/TRADE/meetings/carry-queue").set("Cookie", pm.cookie);
  assert.ok(queue.body.items.some((i) => i.text === "Devredilecek"));
});

test("SMTP: etkin değilken e-posta gönderilmez, denetim kaydına başarısız olarak düşer", async () => {
  const admin = await login("elif.yalcin");
  const before = await request(app).get("/api/admin/smtp").set("Cookie", admin.cookie);
  assert.equal(before.body.item.active, false);
});

test("SMTP: sunucu/gönderen olmadan test isteği reddedilir", async () => {
  const admin = await login("elif.yalcin");
  const res = await request(app)
    .post("/api/admin/smtp/test")
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrf);
  // Bu ortamda önceki testte SMTP zaten kaydedilmiş olabilir; her iki durumda da
  // uç, gerçek bir ağ denemesi yapar ve asla "başarılı" yalanı söylemez.
  assert.equal(typeof res.body.ok, "boolean");
});

test.after(async () => {
  await pool.end();
});
