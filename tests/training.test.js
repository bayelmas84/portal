"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { boot, agentFor } = require("./harness");

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(1024, 0x20)]);

/* Doküman yükleyip Teftiş onayıyla yayına alır; yayın atamayı tetikler. */
async function publishDoc(app, { docNo = "PL-ETIK-002", pages = 1 } = {}) {
  const bg = agentFor(app); await bg.login("burak.temel");
  const up = await bg.post("/api/documents")
    .field("docNo", docNo).field("title", "Etik Kurallar Politikası").field("category", "Yasal").field("pageCount", String(pages))
    .attach("file", PDF, { filename: "etik.pdf", contentType: "application/pdf" });
  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rq = (await insp.get("/api/approvals/inbox")).body.items.find((r) => r.kind === "doc.publish");
  await insp.post(`/api/approvals/${rq.id}/approve`).send({});
  return { docId: up.body.id, docNo, bg, insp };
}

/* Sunucu tarafı süreyi doldurmak için ping'ler arasına gerçek gecikme koyar. */
async function completeReading(agent, docId, pages, cfg) {
  const st = await agent.post(`/api/documents/${docId}/reading/start`).send({});
  const sid = st.body.sessionId;
  for (let p = 0; p < pages; p++) {
    await agent.post(`/api/documents/reading/${sid}/ping`).send({ page: p });
    await new Promise((r) => setTimeout(r, (cfg.READING_SECONDS_PER_PAGE + 1) * 1000));
    await agent.post(`/api/documents/reading/${sid}/ping`).send({ page: p });
  }
  return agent.post(`/api/documents/reading/${sid}/ack`).send({});
}

test("yayına giren doküman tüm aktif kullanıcılara zorunlu okuma olarak atanır", async () => {
  const { app } = await boot();
  await publishDoc(app);
  const staff = agentFor(app); await staff.login("nazli.han");
  const pending = (await staff.get("/api/training/pending")).body.items;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].doc_no, "PL-ETIK-002");
  assert.ok(pending[0].due_date, "son tarih atanmalı");
});

test("sınav okuma onayı verilmeden açılmaz", async () => {
  const { app, pool } = await boot();
  await publishDoc(app);
  await pool.query(`INSERT INTO quiz_questions (doc_no, weight_band, question, options, answer_index)
    VALUES ('PL-ETIK-002','critical','Soru?','["Doğru","Yanlış","Bilmiyorum"]',0)`);
  const staff = agentFor(app); await staff.login("nazli.han");
  const q = await staff.get("/api/training/PL-ETIK-002/quiz");
  assert.equal(q.status, 422);
  assert.match(q.body.error, /okuyup onaylamanız/);
});

test("okuma tamamlanınca sınav açılır, doğru yanıt istemciye gönderilmez", { timeout: 60000 }, async (t) => {
  const { app, pool, cfg } = await boot();
  const { docId } = await publishDoc(app, { pages: 1 });
  await pool.query(`INSERT INTO quiz_questions (doc_no, weight_band, question, options, answer_index)
    VALUES ('PL-ETIK-002','critical','İçsel bilgiyle işlem?','["Yasaktır","Serbesttir","Onayla yapılır"]',0),
           ('PL-ETIK-002','low','Hediye kaydı?','["Tutulur","Tutulmaz","Gerekmez"]',0)`);

  const staff = agentFor(app); await staff.login("nazli.han");
  const ack = await completeReading(staff, docId, 1, cfg);
  assert.equal(ack.status, 200, "okuma onayı verilmeli");

  const q = await staff.get("/api/training/PL-ETIK-002/quiz");
  assert.equal(q.status, 200);
  assert.equal(q.body.questions.length, 2);
  const raw = JSON.stringify(q.body);
  assert.ok(!/answer_index|answerIndex/.test(raw), "doğru yanıt sızmamalı");
  assert.ok(q.body.questions.every((x) => typeof x.weight === "number"), "ağırlık bildirilir");
});

test("sınav puanı sunucuda hesaplanır; 70 altı kalır ve okuma onayı düşer", { timeout: 60000 }, async () => {
  const { app, pool, cfg } = await boot();
  const { docId } = await publishDoc(app, { pages: 1 });
  const qs = await pool.query(`INSERT INTO quiz_questions (doc_no, weight_band, question, options, answer_index)
    VALUES ('PL-ETIK-002','critical','A?','["D","Y","B"]',0),
           ('PL-ETIK-002','low','B?','["D","Y","B"]',0) RETURNING id`);
  const [q1, q2] = qs.rows.map((r) => Number(r.id));

  const staff = agentFor(app); await staff.login("nazli.han");
  await completeReading(staff, docId, 1, cfg);

  /* critical 30 + low 8 = 38; yalnızca low doğru → 21 puan, kalır. */
  const fail = await staff.post("/api/training/PL-ETIK-002/quiz").send({ answers: { [q1]: 1, [q2]: 0 } });
  assert.equal(fail.status, 200);
  assert.equal(fail.body.passed, false);
  assert.equal(fail.body.score, 21);

  const stillPending = (await staff.get("/api/training/pending")).body.items;
  assert.equal(stillPending.length, 1, "kalan kişi listede kalır");
  const acks = await pool.query("SELECT 1 FROM document_acks WHERE username='nazli.han'");
  assert.equal(acks.rows.length, 0, "başarısız sınav sonrası doküman baştan okunur");

  /* Yeniden okuyup doğru yanıtlarsa geçer. */
  await completeReading(staff, docId, 1, cfg);
  const pass = await staff.post("/api/training/PL-ETIK-002/quiz").send({ answers: { [q1]: 0, [q2]: 0 } });
  assert.equal(pass.body.passed, true);
  assert.equal(pass.body.score, 100);
  const done = (await staff.get("/api/training/completed")).body.items;
  assert.equal(done.length, 1);
  assert.equal(done[0].score, 100);
  assert.equal(done[0].attempts, 2, "deneme sayısı kayda geçer");
});

test("süresi geçmiş okuması olan kullanıcı portalın kalanına erişemez", async () => {
  const { app, pool } = await boot();
  await publishDoc(app);
  await pool.query("UPDATE reading_assignments SET due_date = CURRENT_DATE - 3 WHERE username='nazli.han'");

  const staff = agentFor(app); await staff.login("nazli.han");
  const blocked = await staff.get("/api/announcements");
  assert.equal(blocked.status, 423, "diğer bölümler kilitli olmalı");
  assert.deepEqual(blocked.body.overdue, ["PL-ETIK-002"]);

  const allowed = await staff.get("/api/training/pending");
  assert.equal(allowed.status, 200, "okuma bölümü açık kalmalı");

  const me = await staff.get("/api/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.overdueReadings.length, 1, "arayüz kilidi gösterebilsin diye /me bildirir");
});

test("hatırlatma işi son 3 güne girenlere ve süresi geçenlere posta üretir", async () => {
  const { app, pool, cfg } = await boot();
  await publishDoc(app);
  await pool.query("UPDATE reading_assignments SET due_date = CURRENT_DATE + 2 WHERE username='nazli.han'");
  await pool.query("UPDATE reading_assignments SET due_date = CURRENT_DATE - 1 WHERE username='tolga.firat'");
  await pool.query("UPDATE reading_assignments SET due_date = CURRENT_DATE + 20 WHERE username NOT IN ('nazli.han','tolga.firat')");
  await pool.query("DELETE FROM mail_outbox");

  const training = require("../server/src/lib/training");
  const r = await training.runReminders(cfg, "test");
  assert.equal(r.reminded, 1, "yalnızca son 3 güne giren hatırlatılır");
  assert.equal(r.escalated, 1);

  const mails = (await pool.query("SELECT recipient, subject, event_key FROM mail_outbox")).rows;
  const remind = mails.filter((m) => m.event_key === "read.remind").map((m) => m.recipient);
  const overdue = mails.filter((m) => m.event_key === "read.overdue").map((m) => m.recipient);
  assert.deepEqual(remind, ["nazli.han@terayatirim.com.tr"], "hatırlatma yalnızca kişiye gider");
  assert.ok(overdue.includes("tolga.firat@terayatirim.com.tr"));
  assert.ok(overdue.includes("elif.yalcin@terayatirim.com.tr"), "süre aşımında yöneticiye de gider");
  assert.ok(overdue.includes("teftis-kurulu@terayatirim.com.tr"), "Teftiş ekibi bilgilendirilir");
});

test("uyum ekranları: okuma raporu ve hatırlatma planı yalnızca yetkili rollere açık", async () => {
  const { app, pool } = await boot();
  await publishDoc(app);
  await pool.query("UPDATE reading_assignments SET due_date = CURRENT_DATE - 2 WHERE username='nazli.han'");

  const insp = agentFor(app); await insp.login("kerem.aslan");
  const rep = await insp.get("/api/compliance/reading");
  assert.equal(rep.status, 200);
  assert.ok(rep.body.items.length >= 8, "tüm atamalar raporda");
  assert.ok(rep.body.items.some((x) => x.overdue === true), "süresi geçen işaretlenir");

  const plan = await insp.get("/api/compliance/reminders");
  assert.equal(plan.status, 200);
  assert.ok(plan.body.items[0].days_left !== undefined);

  const staff = agentFor(app); await staff.login("meltem.aydin");
  assert.equal((await staff.get("/api/compliance/reading")).status, 403, "yetkisiz rol uyum raporunu görmemeli");
});

test("e-posta kuyruğu SMTP tanımsızken beklemede kalır, kayıp olmaz", async () => {
  const { app, pool, cfg } = await boot();
  const bg = agentFor(app); await bg.login("burak.temel");
  await bg.post("/api/announcements").send({
    title: "Kuyruk testi duyurusu", body: "Kuyruk davranışını sınayan yeterince uzun metin.",
    category: "Yasal", criticality: "Kritik", validUntil: "2027-01-01", popup: false });

  const before = (await pool.query("SELECT COUNT(*)::int AS n FROM mail_outbox WHERE sent_at IS NULL")).rows[0].n;
  assert.ok(before > 0, "bildirim kuyruğa yazılmalı");

  const mailer = require("../server/src/lib/mailer");
  const r = await mailer.flush({ ...cfg, SMTP_HOST: undefined });
  assert.equal(r.sent, 0);
  assert.equal(r.pending, before, "SMTP tanımsızken postalar kuyrukta kalır");
  assert.match(r.note, /SMTP sunucusu tanımlı değil/);
});
