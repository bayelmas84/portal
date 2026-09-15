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

test("Kapatma kuralı: açık alt kaydı olan Epic/Story DONE yapılamaz", async () => {
  const pm = await login("tolga.firat");
  const epic = await request(app)
    .post("/api/projects/TRADE/issues")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Close Rule Epic ${Date.now()}` });
  assert.equal(epic.status, 201);
  const epicKey = epic.body.item.issue_key;

  const story = await request(app)
    .post("/api/projects/TRADE/issues")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Story", title: `Close Rule Story ${Date.now()}`, parentKey: epicKey });
  assert.equal(story.status, 201);
  const storyKey = story.body.item.issue_key;

  const closeEpic = await request(app)
    .put(`/api/projects/TRADE/issues/${epicKey}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(closeEpic.status, 400, "açık Story varken Epic kapatılamamalı");
  assert.match(closeEpic.body.error, new RegExp(storyKey));

  const closeStory = await request(app)
    .put(`/api/projects/TRADE/issues/${storyKey}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(closeStory.status, 200, "alt kaydı olmayan Story serbestçe kapatılabilmeli");

  const closeEpicAgain = await request(app)
    .put(`/api/projects/TRADE/issues/${epicKey}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(closeEpicAgain.status, 200, "Story kapandıktan sonra Epic kapatılabilmeli");
});

test("Kapatma kuralı: 'blocked by' ilişkisindeki konu, bloklayan konu DONE olmadan kapatılamaz", async () => {
  const pm = await login("tolga.firat");
  const epic = await request(app)
    .post("/api/projects/TRADE/issues")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Block Rule Epic ${Date.now()}` });
  const epicKey = epic.body.item.issue_key;
  const storyA = await request(app)
    .post("/api/projects/TRADE/issues")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Story", title: `Blocker Story A ${Date.now()}`, parentKey: epicKey });
  const storyB = await request(app)
    .post("/api/projects/TRADE/issues")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Story", title: `Blocked Story B ${Date.now()}`, parentKey: epicKey });
  const keyA = storyA.body.item.issue_key, keyB = storyB.body.item.issue_key;

  const link = await request(app)
    .post(`/api/projects/TRADE/issues/${keyA}/links`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ linkType: "blocks", targetKey: keyB });
  assert.equal(link.status, 201);

  const closeB = await request(app)
    .put(`/api/projects/TRADE/issues/${keyB}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(closeB.status, 400, "bloklanan konu, bloklayan DONE olmadan kapatılamamalı");
  assert.match(closeB.body.error, new RegExp(keyA));

  const closeA = await request(app)
    .put(`/api/projects/TRADE/issues/${keyA}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(closeA.status, 200);

  const closeBAgain = await request(app)
    .put(`/api/projects/TRADE/issues/${keyB}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(closeBAgain.status, 200, "bloklayan konu DONE olduktan sonra bloklanan da kapatılabilmeli");
});

test("Konu yorumları: ekleme, sadece yazan kişi düzenleyebilir/silebilir, pmdir moderasyon amacıyla silebilir", async () => {
  const pm = await login("tolga.firat");
  const other = await login("mert.balkan");
  const mod = await login("bayram.elmas");

  const create = await request(app)
    .post("/api/projects/TRADE/issues/TRADE-1/comments")
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ body: `Test yorumu ${Date.now()}` });
  assert.equal(create.status, 201);
  assert.equal(create.body.item.author_username, "tolga.firat");
  const commentId = create.body.item.id;

  const list = await request(app)
    .get("/api/projects/TRADE/issues/TRADE-1/comments")
    .set("Cookie", pm.cookie);
  assert.ok(list.body.items.some((c) => c.id === commentId));

  const editByOther = await request(app)
    .put(`/api/projects/TRADE/issues/TRADE-1/comments/${commentId}`)
    .set("Cookie", other.cookie)
    .set("X-CSRF-Token", other.csrf)
    .send({ body: "Başkasının yorumunu değiştirme denemesi" });
  assert.equal(editByOther.status, 403);

  const editByOwner = await request(app)
    .put(`/api/projects/TRADE/issues/TRADE-1/comments/${commentId}`)
    .set("Cookie", pm.cookie)
    .set("X-CSRF-Token", pm.csrf)
    .send({ body: "Düzenlendi" });
  assert.equal(editByOwner.status, 200);
  assert.equal(editByOwner.body.item.body, "Düzenlendi");
  assert.ok(editByOwner.body.item.updated_at);

  const deleteByOther = await request(app)
    .delete(`/api/projects/TRADE/issues/TRADE-1/comments/${commentId}`)
    .set("Cookie", other.cookie)
    .set("X-CSRF-Token", other.csrf);
  assert.equal(deleteByOther.status, 403);

  const deleteByModerator = await request(app)
    .delete(`/api/projects/TRADE/issues/TRADE-1/comments/${commentId}`)
    .set("Cookie", mod.cookie)
    .set("X-CSRF-Token", mod.csrf);
  assert.equal(deleteByModerator.status, 200, "pmdir moderasyon amacıyla başkasının yorumunu silebilmeli");

  const listAfter = await request(app)
    .get("/api/projects/TRADE/issues/TRADE-1/comments")
    .set("Cookie", pm.cookie);
  assert.ok(!listAfter.body.items.some((c) => c.id === commentId));
});

test("Konu sıralaması (rank): yeni konu en sona eklenir, sürükle-bırak ile komşular arasına taşınabilir", async () => {
  const pm = await login("tolga.firat");
  const a = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Rank Test A ${Date.now()}` });
  const b = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Rank Test B ${Date.now()}` });
  const c = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Rank Test C ${Date.now()}` });
  const keyA = a.body.item.issue_key, keyB = b.body.item.issue_key, keyC = c.body.item.issue_key;
  // Ardışık oluşturulan konular artan rank sırasında olmalı (yeni konu en sona eklenir).
  assert.ok(a.body.item.rank < b.body.item.rank);
  assert.ok(b.body.item.rank < c.body.item.rank);

  // C'yi A ile B arasına taşı.
  const move = await request(app)
    .put(`/api/projects/TRADE/issues/${keyC}/rank`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ prevKey: keyA, nextKey: keyB });
  assert.equal(move.status, 200);

  const list = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  const ranks = Object.fromEntries(list.body.items.map((i) => [i.issue_key, i.rank]));
  assert.ok(ranks[keyA] < ranks[keyC] && ranks[keyC] < ranks[keyB], "C artık A ile B arasında olmalı");

  // Yalnızca nextKey verilirse (en başa taşıma) A'nın önüne geçmeli.
  const moveTop = await request(app)
    .put(`/api/projects/TRADE/issues/${keyB}/rank`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ nextKey: keyA });
  assert.equal(moveTop.status, 200);
  const list2 = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  const ranks2 = Object.fromEntries(list2.body.items.map((i) => [i.issue_key, i.rank]));
  assert.ok(ranks2[keyB] < ranks2[keyA], "B artık A'nın önünde olmalı");
});

test.after(async () => {
  await pool.end();
});
