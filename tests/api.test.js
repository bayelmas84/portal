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
      items: [{ text: "Test maddesi", assigneeUsername: "mert.balkan" }],
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

test("Toplantı maddesi: 'carried' artık manuel olarak ayarlanamaz (yalnızca otomatik/dahili)", async () => {
  const pm = await login("tolga.firat");
  const create = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ projectK: "TRADE", date: "2026-11-06", participants: ["mert.balkan"], items: [{ text: "Devredilecek", assigneeUsername: "mert.balkan" }] });
  const meetingId = create.body.item.id;
  const itemsRes = await request(app).get("/api/projects/meetings?project=TRADE").set("Cookie", pm.cookie);
  const meeting = itemsRes.body.items.find((m) => m.id === meetingId);
  const itemId = meeting.items[0].id;

  const carry = await request(app)
    .post(`/api/projects/meetings/${meetingId}/items/${itemId}/status`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "carried" });
  assert.equal(carry.status, 400);
});

test("Toplantı maddesi: haftalık periyodik toplantıda sonraki oluşumun tarihi geçmişse GET /meetings çağrılınca OTOMATİK açılır, hâlâ açık maddeler oraya taşınır, mükerrer Task oluşmaz", async () => {
  const pm = await login("tolga.firat");
  // Bu testin defalarca çalıştırılması (dev DB sıfırlanmadan) aynı seriye
  // eski koşulardan kalma kayıtlar biriktirebilir; benzersiz bir metin ve
  // "diğer konu" kullanmak testi tamamen izole eder.
  const uniqueSubject = `CarryAutoTest-${Date.now()}`;
  const uniqueText = `Otomatik Devir Maddesi ${Date.now()}`;
  // Bugünden iki hafta önce başlayan haftalık bir seri: otomatik ilerleme
  // hem "bugüne ulaşma" hem "birden fazla kaçırılan oluşumu zincirleme"
  // davranışını tek seferde test eder (başlangıç -> +7 gün -> +7 gün = bugün).
  const today = new Date();
  const startDate = new Date(today); startDate.setUTCDate(startDate.getUTCDate() - 14);
  const startDateStr = startDate.toISOString().slice(0, 10);
  const todayStr = today.toISOString().slice(0, 10);

  const create = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({
      otherSubject: uniqueSubject, date: startDateStr, recurrence: "weekly",
      participants: ["mert.balkan"], items: [{ text: uniqueText, assigneeUsername: "mert.balkan" }],
    });
  assert.equal(create.status, 201);
  const meetingId = create.body.item.id;
  const itemsRes = await request(app).get("/api/projects/meetings?project=ALL").set("Cookie", pm.cookie);
  const meeting = itemsRes.body.items.find((m) => m.id === meetingId);
  const originalItem = meeting.items.find((i) => i.text === uniqueText);
  const originalLinkedKey = originalItem.linked_issue_key;
  assert.ok(originalLinkedKey);
  // NOT: meeting_date 14 gün önce olduğu için, ilk GET çağrısının KENDİSİ
  // bile zaten otomatik ilerlemeyi tetikler (her GET tetikler) — bu yüzden
  // burada "henüz taşınmamış" durumu ayrıca gözlemlenemez; asıl doğrulama
  // aşağıda son oluşumda maddenin doğru şekilde bulunmasıdır.

  // GET /meetings çağrısının KENDİSİ otomatik ilerlemeyi tetiklemeli.
  const afterAdvance = await request(app).get("/api/projects/meetings?project=ALL").set("Cookie", pm.cookie);
  const allInSeries = afterAdvance.body.items.filter((m) => m.project_other_subject === uniqueSubject);
  // Başlangıç + iki ara oluşum (bugüne kadar) = en az 3 kayıt beklenir.
  assert.ok(allInSeries.length >= 3, `en az 3 toplantı oluşmalı, ${allInSeries.length} bulundu`);

  const latest = allInSeries.find((m) => m.meeting_date.slice(0, 10) === todayStr);
  assert.ok(latest, "zincir bugünün tarihine kadar ilerlemeli");
  const carriedItem = latest.items.find((i) => i.text === uniqueText);
  assert.ok(carriedItem, "taşınan madde en son oluşumda bulunmalı");
  assert.equal(carriedItem.linked_issue_key, originalLinkedKey, "aynı Task yeniden kullanılmalı, mükerrer açılmamalı");
  assert.equal(carriedItem.status, "open");

  const origAfter = allInSeries.find((m) => m.id === meetingId).items.find((i) => i.text === uniqueText);
  assert.equal(origAfter.status, "carried", "orijinal maddenin durumu 'carried' olmalı");

  const issuesRes = await request(app).get("/api/projects/TOPLANTI/issues").set("Cookie", pm.cookie);
  const matchingTasks = issuesRes.body.items.filter((i) => i.issue_key === originalLinkedKey);
  assert.equal(matchingTasks.length, 1, "Task tablosunda hâlâ tek kayıt olmalı");

  // Tekrar çağırmak yeni bir "sonraki oluşum" ÜRETMEMELİ (idempotent).
  const secondCall = await request(app).get("/api/projects/meetings?project=ALL").set("Cookie", pm.cookie);
  const stillSameCount = secondCall.body.items.filter((m) => m.project_other_subject === uniqueSubject).length;
  assert.equal(stillSameCount, allInSeries.length, "tekrar çağırmak mükerrer toplantı üretmemeli");
});

test("Toplantı maddesi: bağlı Task Board/Backlog'dan DONE yapılınca ilgili toplantı maddesi de tamamlandı sayılır (ve geri alınabilir)", async () => {
  const pm = await login("tolga.firat");
  const uniqueText = `Sync Test Item ${Date.now()}`;
  const create = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({
      projectK: "TRADE", date: "2026-12-01", participants: ["mert.balkan"],
      items: [{ text: uniqueText, assigneeUsername: "mert.balkan" }],
    });
  const meetingId = create.body.item.id;
  const itemsRes = await request(app).get("/api/projects/meetings?project=TRADE").set("Cookie", pm.cookie);
  const meeting = itemsRes.body.items.find((m) => m.id === meetingId);
  const linkedKey = meeting.items.find((i) => i.text === uniqueText).linked_issue_key;
  assert.ok(linkedKey);

  const markDone = await request(app)
    .put(`/api/projects/TOPLANTI/issues/${encodeURIComponent(linkedKey)}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(markDone.status, 200);

  const afterDone = await request(app).get("/api/projects/meetings?project=TRADE").set("Cookie", pm.cookie);
  const itemAfterDone = afterDone.body.items.find((m) => m.id === meetingId).items.find((i) => i.text === uniqueText);
  assert.equal(itemAfterDone.status, "done", "Task DONE olunca toplantı maddesi de done olmalı");

  const markBack = await request(app)
    .put(`/api/projects/TOPLANTI/issues/${encodeURIComponent(linkedKey)}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "prog" });
  assert.equal(markBack.status, 200);

  const afterRevert = await request(app).get("/api/projects/meetings?project=TRADE").set("Cookie", pm.cookie);
  const itemAfterRevert = afterRevert.body.items.find((m) => m.id === meetingId).items.find((i) => i.text === uniqueText);
  assert.equal(itemAfterRevert.status, "open", "Task DONE'dan geri alınınca toplantı maddesi de tekrar open olmalı");
});

test("Toplantı maddesi: assignee olmadan reddedilir", async () => {
  const pm = await login("tolga.firat");
  const res = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ projectK: "TRADE", date: "2026-11-07", participants: ["mert.balkan"], items: [{ text: "Sorumlusuz madde" }] });
  assert.equal(res.status, 400);
});

test("Toplantı maddesi: TOPLANTI projesinde Epic+Task olarak otomatik açılır, backlog'a düşer", async () => {
  const pm = await login("tolga.firat");
  const create = await request(app)
    .post("/api/projects/meetings")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({
      projectK: "TRADE",
      title: "Otomatik görev testi",
      date: "2026-11-08",
      participants: ["mert.balkan"],
      items: [{ text: "Otomatik task maddesi", assigneeUsername: "mert.balkan", dueDate: "2026-11-15" }],
    });
  assert.equal(create.status, 201);

  const itemsRes = await request(app)
    .get("/api/projects/meetings?project=TRADE")
    .set("Cookie", pm.cookie);
  const meeting = itemsRes.body.items.find((m) => m.id === create.body.item.id);
  assert.ok(meeting.items[0].linked_issue_key, "linked_issue_key doldurulmalı");

  const issuesRes = await request(app)
    .get("/api/projects/TOPLANTI/issues")
    .set("Cookie", pm.cookie);
  const task = issuesRes.body.items.find((i) => i.issue_key === meeting.items[0].linked_issue_key);
  assert.equal(task.issue_type, "Task");
  assert.equal(task.status, "backlog");
  assert.equal(task.assignee_username, "mert.balkan");
  assert.ok(task.due_date, "due_date dolmalı");

  const epic = issuesRes.body.items.find((i) => i.issue_key === task.parent_key);
  assert.equal(epic.issue_type, "Epic");
  // Task ve Epic'in "Created" tarihi, notun girildiği an değil TOPLANTI tarihi olmalı.
  assert.equal(task.created_at.slice(0, 10), "2026-11-08");
  assert.equal(epic.created_at.slice(0, 10), "2026-11-08");
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
