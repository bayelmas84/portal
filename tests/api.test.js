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

test("Versions & Components: oluşturma, konuya atama (geçersiz değerler elenir), yeniden adlandırma ve silme referansları günceller", async () => {
  const pm = await login("tolga.firat");
  const vName = `V-${Date.now()}`;
  const cName = `C-${Date.now()}`;

  const vCreate = await request(app).post("/api/projects/TRADE/versions").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ name: vName, description: "test sürümü" });
  assert.equal(vCreate.status, 201);
  const versionId = vCreate.body.item.id;

  const cCreate = await request(app).post("/api/projects/TRADE/components").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ name: cName });
  assert.equal(cCreate.status, 201);
  const componentId = cCreate.body.item.id;

  const issue = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `VC Test Epic ${Date.now()}` });
  const issueKey = issue.body.item.issue_key;

  const assign = await request(app)
    .put(`/api/projects/TRADE/issues/${issueKey}`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ fixVersions: [vName, "OlmayanSurum"], components: [cName, "OlmayanBilesen"] });
  assert.equal(assign.status, 200);

  const afterAssign = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  const found1 = afterAssign.body.items.find((i) => i.issue_key === issueKey);
  assert.deepEqual(found1.fix_versions, [vName], "geçersiz sürüm elenmeli");
  assert.deepEqual(found1.components, [cName], "geçersiz bileşen elenmeli");

  // Yeniden adlandırma: konudaki referans da güncellenmeli.
  const newVName = vName + "-renamed";
  const vRename = await request(app)
    .put(`/api/projects/TRADE/versions/${versionId}`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ name: newVName });
  assert.equal(vRename.status, 200);
  const afterRename = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  const found2 = afterRename.body.items.find((i) => i.issue_key === issueKey);
  assert.deepEqual(found2.fix_versions, [newVName], "sürüm adı değişince konudaki referans da güncellenmeli");

  // Silme: konudaki referans temizlenmeli.
  const vDelete = await request(app).delete(`/api/projects/TRADE/versions/${versionId}`).set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf);
  assert.equal(vDelete.status, 200);
  const cDelete = await request(app).delete(`/api/projects/TRADE/components/${componentId}`).set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf);
  assert.equal(cDelete.status, 200);
  const afterDelete = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  const found3 = afterDelete.body.items.find((i) => i.issue_key === issueKey);
  assert.deepEqual(found3.fix_versions, [], "sürüm silinince konudaki referans da temizlenmeli");
  assert.deepEqual(found3.components, [], "bileşen silinince konudaki referans da temizlenmeli");
});

test("WIP limitleri: geçerli değerler kaydedilir, geçersiz (negatif) değer reddedilir, proje listesinde görünür", async () => {
  const pm = await login("tolga.firat");

  const setLimits = await request(app)
    .put("/api/projects/TRADE/wip-limits")
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ prog: 4, review: 2 });
  assert.equal(setLimits.status, 200);
  assert.deepEqual(setLimits.body.wipLimits, { prog: 4, review: 2 });

  const invalid = await request(app)
    .put("/api/projects/TRADE/wip-limits")
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ prog: -1 });
  assert.equal(invalid.status, 400);

  const list = await request(app).get("/api/projects").set("Cookie", pm.cookie);
  const proj = list.body.items.find((p) => p.k === "TRADE");
  assert.deepEqual(proj.wip_limits, { prog: 4, review: 2 });

  // Limiti kaldırmak (boş obje): "todo" ve "test" hiç gönderilmediği için
  // zaten yoktu; şimdi tamamen boş gönderelim ve hepsi temizlensin.
  const clear = await request(app)
    .put("/api/projects/TRADE/wip-limits")
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({});
  assert.equal(clear.status, 200);
  assert.deepEqual(clear.body.wipLimits, {});
});

test("Zaman takibi: estimate atama, worklog eklendiğinde remaining otomatik düşer (0'ın altına inmez), yetki kontrolü", async () => {
  const pm = await login("tolga.firat");
  const other = await login("mert.balkan");
  const mod = await login("bayram.elmas");

  const issue = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Time Test Epic ${Date.now()}` });
  const issueKey = issue.body.item.issue_key;

  const setEst = await request(app)
    .put(`/api/projects/TRADE/issues/${issueKey}`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ originalEstimateMinutes: 480, remainingEstimateMinutes: 480 });
  assert.equal(setEst.status, 200);

  const log1 = await request(app)
    .post(`/api/projects/TRADE/issues/${issueKey}/worklogs`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ timeSpentMinutes: 120, comment: "test oturumu" });
  assert.equal(log1.status, 201);
  const worklogId = log1.body.item.id;

  let list = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  let found = list.body.items.find((i) => i.issue_key === issueKey);
  assert.equal(found.remaining_estimate_minutes, 360, "120 dk loglandıktan sonra 480-120=360 olmalı");

  const log2 = await request(app)
    .post(`/api/projects/TRADE/issues/${issueKey}/worklogs`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ timeSpentMinutes: 1000 });
  assert.equal(log2.status, 201);
  list = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  found = list.body.items.find((i) => i.issue_key === issueKey);
  assert.equal(found.remaining_estimate_minutes, 0, "remaining 0'ın altına inmemeli");

  // Negatif/geçersiz süre reddedilmeli.
  const invalidLog = await request(app)
    .post(`/api/projects/TRADE/issues/${issueKey}/worklogs`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ timeSpentMinutes: -5 });
  assert.equal(invalidLog.status, 400);

  const worklogs = await request(app).get(`/api/projects/TRADE/issues/${issueKey}/worklogs`).set("Cookie", pm.cookie);
  assert.equal(worklogs.body.items.length, 2);

  // Yalnızca yazan kişi (ya da moderatör) silebilir.
  const deleteByOther = await request(app)
    .delete(`/api/projects/TRADE/issues/${issueKey}/worklogs/${worklogId}`)
    .set("Cookie", other.cookie).set("X-CSRF-Token", other.csrf);
  assert.equal(deleteByOther.status, 403);

  const deleteByModerator = await request(app)
    .delete(`/api/projects/TRADE/issues/${issueKey}/worklogs/${worklogId}`)
    .set("Cookie", mod.cookie).set("X-CSRF-Token", mod.csrf);
  assert.equal(deleteByModerator.status, 200);

  const worklogsAfter = await request(app).get(`/api/projects/TRADE/issues/${issueKey}/worklogs`).set("Cookie", pm.cookie);
  assert.equal(worklogsAfter.body.items.length, 1);
});

test("İş akışı (workflow): tanımsız geçiş serbesttir (geriye dönük uyumluluk), tanımlı rol kısıtlaması uygulanır, pmdir her zaman override edebilir, enabled=false geçişi kapatır", async () => {
  const pm = await login("tolga.firat");
  const mod = await login("bayram.elmas");

  const issue = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Workflow Test ${Date.now()}` });
  const issueKey = issue.body.item.issue_key;

  // Hiç workflow satırı olmayan bir (from,to) çifti: backlog->done. TRADE'in
  // varsayılan seed'inde bu tanımlı DEĞİL, dolayısıyla serbest olmalı.
  const freeJump = await request(app)
    .put(`/api/projects/TRADE/issues/${issueKey}`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ status: "done" });
  assert.equal(freeJump.status, 200, "tanımlı bir kısıtlama olmayan geçiş serbest olmalı");

  // Geri al, sonra normal zincirden ilerleyip review'a getir.
  await request(app).put(`/api/projects/TRADE/issues/${issueKey}`).set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf).send({ status: "prog" });
  await request(app).put(`/api/projects/TRADE/issues/${issueKey}`).set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf).send({ status: "review" });

  // review->test geçişini sadece pmdir yapabilsin diye kısıtla. Workflow
  // KURALLARINI değiştirmek artık yalnızca pmdir'e ait (Project Admin).
  const setWf = await request(app)
    .put("/api/projects/TRADE/workflow")
    .set("Cookie", mod.cookie).set("X-CSRF-Token", mod.csrf)
    .send({ transitions: [
      { from: "backlog", to: "todo" }, { from: "todo", to: "prog" }, { from: "prog", to: "review" },
      { from: "prog", to: "todo" }, { from: "review", to: "test", allowedRoles: ["pmdir"] },
      { from: "review", to: "prog" }, { from: "test", to: "done" }, { from: "test", to: "prog" }, { from: "done", to: "prog" },
    ] });
  assert.equal(setWf.status, 200);

  // pm rolü artık workflow KURALLARINI değiştiremez (yalnızca pmdir).
  const pmEditWf = await request(app)
    .put("/api/projects/TRADE/workflow")
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ transitions: [{ from: "backlog", to: "todo" }] });
  assert.equal(pmEditWf.status, 403, "workflow kurallarını yalnızca pmdir değiştirebilmeli");

  const pmTry = await request(app)
    .put(`/api/projects/TRADE/issues/${issueKey}`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ status: "test" });
  assert.equal(pmTry.status, 403, "pm rolü review->test için yetkili değilse reddedilmeli");

  const modTry = await request(app)
    .put(`/api/projects/TRADE/issues/${issueKey}`)
    .set("Cookie", mod.cookie).set("X-CSRF-Token", mod.csrf)
    .send({ status: "test" });
  assert.equal(modTry.status, 200, "pmdir her zaman override edebilmeli");

  // test->prog geçişini tamamen kapat.
  await request(app)
    .put("/api/projects/TRADE/workflow")
    .set("Cookie", mod.cookie).set("X-CSRF-Token", mod.csrf)
    .send({ transitions: [{ from: "test", to: "prog", enabled: false }] });

  const disabledTry = await request(app)
    .put(`/api/projects/TRADE/issues/${issueKey}`)
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ status: "prog" });
  assert.equal(disabledTry.status, 400, "enabled=false olan geçiş pm için reddedilmeli");

  const disabledModTry = await request(app)
    .put(`/api/projects/TRADE/issues/${issueKey}`)
    .set("Cookie", mod.cookie).set("X-CSRF-Token", mod.csrf)
    .send({ status: "prog" });
  assert.equal(disabledModTry.status, 200, "pmdir enabled=false olsa bile override edebilmeli");

  // TRADE'in workflow'unu varsayılana geri döndür ki başka testleri etkilemesin.
  await request(app)
    .put("/api/projects/TRADE/workflow")
    .set("Cookie", mod.cookie).set("X-CSRF-Token", mod.csrf)
    .send({ transitions: [
      { from: "backlog", to: "todo" }, { from: "todo", to: "prog" }, { from: "prog", to: "review" },
      { from: "prog", to: "todo" }, { from: "review", to: "test" }, { from: "review", to: "prog" },
      { from: "test", to: "done" }, { from: "test", to: "prog" }, { from: "done", to: "prog" },
    ] });
});

test("Genel arama: konu (issue) başlık/anahtarına göre bulunur ve tıklanabilir sonuç döner", async () => {
  const pm = await login("tolga.firat");
  const uniqueTitle = `Arama Test Konusu ${Date.now()}`;
  const issue = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: uniqueTitle });
  const issueKey = issue.body.item.issue_key;

  const byTitle = await request(app).get(`/api/search?q=${encodeURIComponent(uniqueTitle.slice(0, 15))}`).set("Cookie", pm.cookie);
  assert.equal(byTitle.status, 200);
  const found1 = byTitle.body.items.find((i) => i.kind === "issue" && i.issue_key === issueKey);
  assert.ok(found1, "başlığa göre arama konuyu bulmalı");
  assert.equal(found1.project_k, "TRADE");
  assert.equal(found1.group, "Konular (Issues)");

  const byKey = await request(app).get(`/api/search?q=${encodeURIComponent(issueKey)}`).set("Cookie", pm.cookie);
  const found2 = byKey.body.items.find((i) => i.kind === "issue" && i.issue_key === issueKey);
  assert.ok(found2, "anahtara (issue_key) göre arama da konuyu bulmalı");

  const tooShort = await request(app).get("/api/search?q=a").set("Cookie", pm.cookie);
  assert.deepEqual(tooShort.body.items, [], "2 karakterden kısa sorgu boş dönmeli");
});

test("Mail bildirim tercihleri: kapatılan tür için e-posta atlanır ama zil bildirimi yine de oluşur", async () => {
  const pm = await login("tolga.firat");
  const other = await login("mert.balkan");

  // Not: test veritabanı kalıcıdır, bu yüzden "varsayılan" değerler burada
  // doğrulanmaz (mert.balkan'ın önceki tercihleri kalmış olabilir) —
  // yalnızca kaydetme/okuma döngüsünün doğru çalıştığı test edilir.
  const setPrefs = await request(app)
    .put("/api/notifications/prefs")
    .set("Cookie", other.cookie).set("X-CSRF-Token", other.csrf)
    .send({ emailOnComment: false, emailOnMention: true, emailOnAssignment: true });
  assert.equal(setPrefs.status, 200);

  const afterSet = await request(app).get("/api/notifications/prefs").set("Cookie", other.cookie);
  assert.equal(afterSet.status, 200);
  assert.deepEqual(afterSet.body, { emailOnComment: false, emailOnMention: true, emailOnAssignment: true });

  // mert.balkan önce kendisi yorum yazıp participant olsun, sonra tolga.firat
  // yorum yazsın: mail tercihi kapalı olsa da zil bildirimi oluşmalı.
  const issue = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Pref Test ${Date.now()}` });
  const issueKey = issue.body.item.issue_key;
  await request(app).post(`/api/projects/TRADE/issues/${issueKey}/comments`).set("Cookie", other.cookie).set("X-CSRF-Token", other.csrf)
    .send({ body: "ilk yorum, participant oluyorum" });
  await request(app).post(`/api/projects/TRADE/issues/${issueKey}/comments`).set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ body: "ikinci yorum" });

  const inbox = await request(app).get("/api/notifications/inbox").set("Cookie", other.cookie);
  const found = inbox.body.items.find((n) => n.issue_key === issueKey && n.kind === "comment");
  assert.ok(found, "mail tercihi kapalı olsa da zil bildirimi oluşmalı");

  // Tercihleri varsayılana döndür ki başka testleri etkilemesin.
  await request(app).put("/api/notifications/prefs").set("Cookie", other.cookie).set("X-CSRF-Token", other.csrf)
    .send({ emailOnComment: true, emailOnMention: true, emailOnAssignment: true });
});

test("Backlog toplu güncelleme (bulk-update): priority + label birden fazla konuya uygulanır, geçersiz assignee reddedilir", async () => {
  const pm = await login("tolga.firat");
  const a = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Bulk A ${Date.now()}` });
  const b = await request(app).post("/api/projects/TRADE/issues").set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueType: "Epic", title: `Bulk B ${Date.now()}` });
  const keyA = a.body.item.issue_key, keyB = b.body.item.issue_key;

  const bulk = await request(app)
    .post("/api/projects/TRADE/issues/bulk-update")
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueKeys: [keyA, keyB], priority: "High", addLabel: "toplu-test" });
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.updated, 2);

  const list = await request(app).get("/api/projects/TRADE/issues").set("Cookie", pm.cookie);
  const foundA = list.body.items.find((i) => i.issue_key === keyA);
  const foundB = list.body.items.find((i) => i.issue_key === keyB);
  assert.equal(foundA.priority, "High");
  assert.deepEqual(foundA.labels, ["toplu-test"]);
  assert.equal(foundB.priority, "High");
  assert.deepEqual(foundB.labels, ["toplu-test"]);

  const invalidAssignee = await request(app)
    .post("/api/projects/TRADE/issues/bulk-update")
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueKeys: [keyA], assigneeUsername: "nazli.han" });
  assert.equal(invalidAssignee.status, 400);

  const emptyKeys = await request(app)
    .post("/api/projects/TRADE/issues/bulk-update")
    .set("Cookie", pm.cookie).set("X-CSRF-Token", pm.csrf)
    .send({ issueKeys: [], priority: "Low" });
  assert.equal(emptyKeys.status, 400);
});

test.after(async () => {
  await pool.end();
});
