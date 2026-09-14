"use strict";
/* Zorunlu okuma: atama, hatırlatma, kavrama sınavı.
   Sınav puanı sunucuda hesaplanır; doğru yanıt hiçbir uçtan istemciye gönderilmez. */
const db = require("./db");
const audit = require("./audit");
const notify = require("../services/notify");

const WEIGHTS = { critical: 30, high: 20, medium: 12, low: 8 };

/* Doküman yayına girdiğinde tüm aktif kullanıcılara atanır.
   Aynı doküman için önceki atama varsa yeni sürümde sıfırlanır. */
async function assignToAll(docNo, dueDays, actor) {
  const users = await db.many("SELECT username FROM users WHERE active = TRUE");
  const due = new Date(Date.now() + dueDays * 86400000).toISOString().slice(0, 10);
  for (const u of users) {
    await db.query(
      `INSERT INTO reading_assignments (username, doc_no, due_date)
       VALUES ($1,$2,$3)
       ON CONFLICT (username, doc_no)
       DO UPDATE SET due_date = EXCLUDED.due_date, completed_at = NULL, score = NULL, attempts = 0, escalated_at = NULL`,
      [u.username, docNo, due]);
  }
  await audit.record("okuma.atandi", actor || "sistem", { detail: { doc: docNo, kisi: users.length, son_tarih: due } });
  return users.length;
}

const overdueOf = (username) =>
  db.many(
    `SELECT doc_no, due_date FROM reading_assignments
      WHERE username = $1 AND completed_at IS NULL AND due_date < CURRENT_DATE
      ORDER BY due_date ASC`, [username]);

const pendingOf = (username) =>
  db.many(
    `SELECT ra.doc_no, ra.due_date, ra.attempts, d.id AS doc_id, d.title, d.version, d.page_count
       FROM reading_assignments ra
       JOIN documents d ON d.doc_no = ra.doc_no AND d.status = 'yayinda'
      WHERE ra.username = $1 AND ra.completed_at IS NULL
      ORDER BY ra.due_date ASC`, [username]);

const completedOf = (username) =>
  db.many(
    `SELECT ra.doc_no, ra.completed_at, ra.score, ra.attempts, d.title
       FROM reading_assignments ra
       LEFT JOIN documents d ON d.doc_no = ra.doc_no AND d.status = 'yayinda'
      WHERE ra.username = $1 AND ra.completed_at IS NOT NULL
      ORDER BY ra.completed_at DESC`, [username]);

/* Sınav soruları istemciye doğru yanıt olmadan gönderilir. */
async function questionsFor(docNo) {
  const rows = await db.many(
    "SELECT id, weight_band, question, options FROM quiz_questions WHERE doc_no = $1 ORDER BY id", [docNo]);
  return rows.map((q) => ({
    id: Number(q.id),
    weight: WEIGHTS[q.weight_band],
    question: q.question,
    options: typeof q.options === "string" ? JSON.parse(q.options) : q.options,
  }));
}

/* Puanlama sunucuda. Geçemeyen kullanıcı dokümanı yeniden okur. */
async function grade(docNo, username, answers, passScore, cfg) {
  const rows = await db.many(
    "SELECT id, weight_band, answer_index FROM quiz_questions WHERE doc_no = $1", [docNo]);
  if (!rows.length) throw Object.assign(new Error("Bu doküman için sınav tanımlı değil"), { status: 409 });

  let total = 0, earned = 0;
  const wrong = [];
  for (const q of rows) {
    const w = WEIGHTS[q.weight_band];
    total += w;
    if (Number(answers[q.id]) === Number(q.answer_index)) earned += w;
    else wrong.push(Number(q.id));
  }
  const score = Math.round((earned / total) * 100);
  const passed = score >= passScore;

  await db.query(
    `UPDATE reading_assignments
        SET attempts = attempts + 1,
            score = $1,
            completed_at = CASE WHEN $2 THEN now() ELSE NULL END
      WHERE username = $3 AND doc_no = $4`,
    [score, passed, username, docNo]);

  /* Başarısız denemede okuma onayı da düşer: doküman baştan okunur. */
  if (!passed) {
    const d = await db.one("SELECT doc_no, version FROM documents WHERE doc_no = $1 AND status='yayinda'", [docNo]);
    if (d) await db.query("DELETE FROM document_acks WHERE doc_no=$1 AND version=$2 AND username=$3",
      [d.doc_no, d.version, username]);
  }
  await audit.record(passed ? "sinav.gecti" : "sinav.kaldi", username,
    { ok: passed, detail: { doc: docNo, puan: score, gecme: passScore } });
  return { score, passed, wrong, passScore };
}

/* Günlük hatırlatma: son 3, 2, 1 ve 0 gün; süre geçtiyse her gün, yönetici ve Teftiş bilgilendirilir. */
async function runReminders(cfg, actor = "zamanlanmis-gorev") {
  const rows = await db.many(
    `SELECT ra.username, ra.doc_no, ra.due_date, ra.escalated_at, u.display_name
       FROM reading_assignments ra
       JOIN users u ON u.username = ra.username AND u.active = TRUE
      WHERE ra.completed_at IS NULL`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let reminded = 0, escalated = 0;

  for (const r of rows) {
    const due = new Date(r.due_date); due.setHours(0, 0, 0, 0);
    const days = Math.round((due - today) / 86400000);
    if (days > 3) continue;

    if (days >= 0) {
      await notify.send("read.remind",
        { subject: `Zorunlu okuma hatırlatması: ${r.doc_no} — ${days === 0 ? "son gün" : days + " gün kaldı"}`,
          requester: r.username }, cfg, actor);
      reminded++;
    } else {
      await notify.send("read.overdue",
        { subject: `Zorunlu okuma süresi aşıldı: ${r.doc_no} — ${r.display_name}`, requester: r.username }, cfg, actor);
      await db.query("UPDATE reading_assignments SET escalated_at = now() WHERE username=$1 AND doc_no=$2",
        [r.username, r.doc_no]);
      escalated++;
    }
  }
  await audit.record("okuma.hatirlatma", actor, { detail: { hatirlatilan: reminded, yukseltilen: escalated } });
  return { reminded, escalated, checked: rows.length };
}

/* Uyum raporu: kim okudu, kim kaldı, kimin süresi geçti */
const complianceReport = (docNo) =>
  db.many(
    `SELECT ra.username, u.display_name, u.manager, ra.due_date, ra.completed_at, ra.score, ra.attempts,
            (ra.completed_at IS NULL AND ra.due_date < CURRENT_DATE) AS overdue
       FROM reading_assignments ra
       JOIN users u ON u.username = ra.username
      WHERE ra.doc_no = $1
      ORDER BY ra.completed_at NULLS FIRST, u.display_name`, [docNo]);

const reminderPlan = () =>
  db.many(
    `SELECT ra.username, u.display_name, u.manager, ra.doc_no, ra.due_date, ra.escalated_at,
            (ra.due_date - CURRENT_DATE) AS days_left
       FROM reading_assignments ra
       JOIN users u ON u.username = ra.username AND u.active = TRUE
      WHERE ra.completed_at IS NULL
      ORDER BY ra.due_date ASC`);

module.exports = {
  WEIGHTS, assignToAll, overdueOf, pendingOf, completedOf,
  questionsFor, grade, runReminders, complianceReport, reminderPlan,
};
