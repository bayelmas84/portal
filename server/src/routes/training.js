"use strict";
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const { query, withTransaction } = require("../db");
const { requireRead, requireWrite } = require("../middleware/auth");
const { config } = require("../config");
const { audit } = require("../lib/audit");
const { getNumberSetting } = require("../lib/settings");
const { notifyEvent, notifyApprovalCreated, emailOf } = require("../lib/notify");

const router = express.Router();

const UPLOAD_DIR = path.join(config.uploadDir || "/tmp/uploads", "policy-documents");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + ".pdf"),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Yalnızca PDF dosyası kabul edilir."));
    cb(null, true);
  },
});

router.get("/", requireRead("training"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ta.*, pd.doc_no, pd.title, pd.version
       FROM training_assignments ta JOIN policy_documents pd ON pd.id = ta.policy_document_id
       WHERE ta.username = $1 AND pd.status = 'yayinda' AND ta.cancelled_at IS NULL
       ORDER BY ta.due_at`,
      [req.user.username]
    );
    const now = Date.now();
    res.json({
      items: rows.map((r) => ({
        ...r,
        overdue: !r.completed_at && new Date(r.due_at).getTime() < now,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// Sınav sorularını DOĞRU CEVAP OLMADAN döner — yalnızca kendi atamanız için.
router.get("/:assignmentId/questions", requireRead("training"), async (req, res, next) => {
  try {
    const { rows: aRows } = await query(
      "SELECT * FROM training_assignments WHERE id=$1 AND username=$2",
      [req.params.assignmentId, req.user.username]
    );
    if (!aRows.length) return res.status(404).json({ error: "Atama bulunamadı." });
    const { rows } = await query(
      "SELECT id, question_text, options FROM policy_document_questions WHERE policy_document_id=$1 ORDER BY position",
      [aRows[0].policy_document_id]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

// Sınav puanı SUNUCUDA hesaplanır: doğru cevaplar ve ağırlıklar veritabanından
// okunur, istemciden hiçbir zaman kabul edilmez.
router.post("/:assignmentId/quiz", requireRead("training"), async (req, res, next) => {
  try {
    const { answers } = req.body || {};
    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ error: "Yanıtlar eksik." });
    }
    const { rows } = await query(
      "SELECT * FROM training_assignments WHERE id=$1 AND username=$2",
      [req.params.assignmentId, req.user.username]
    );
    if (!rows.length) return res.status(404).json({ error: "Atama bulunamadı." });
    const assignment = rows[0];

    const { rows: qRows } = await query(
      "SELECT id, correct_index, weight FROM policy_document_questions WHERE policy_document_id=$1",
      [assignment.policy_document_id]
    );
    if (!qRows.length) return res.status(409).json({ error: "Bu doküman için sınav sorusu tanımlanmamış." });

    let total = 0;
    let earned = 0;
    const wrong = [];
    for (const q of qRows) {
      total += q.weight;
      if (Number(answers[q.id]) === q.correct_index) earned += q.weight;
      else wrong.push(q.id);
    }
    const score = total > 0 ? Math.round((earned / total) * 100) : 0;
    const passScore = await getNumberSetting("quiz_pass_score");
    const pass = score >= passScore;

    await query(
      `UPDATE training_assignments SET attempts = attempts + 1, quiz_score = $1,
         completed_at = CASE WHEN $2 THEN now() ELSE completed_at END
       WHERE id = $3`,
      [score, pass, req.params.assignmentId]
    );
    await audit(`Kavrama sınavı ${pass ? "geçildi" : "geçilemedi"} (${score}/100): #${req.params.assignmentId}`, req.user.username, pass);
    res.json({ score, pass, wrong: pass ? [] : wrong });
  } catch (e) {
    next(e);
  }
});

// --------------------------- Doküman yönetimi (Teftiş/Admin) ---------------------------

router.get("/documents", requireWrite("training"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pd.*, (SELECT count(*) FROM policy_document_questions q WHERE q.policy_document_id=pd.id) AS question_count,
        (SELECT count(*) FROM training_assignments ta WHERE ta.policy_document_id=pd.id) AS assignment_count,
        (SELECT count(*) FROM training_assignments ta WHERE ta.policy_document_id=pd.id AND ta.completed_at IS NOT NULL) AS completed_count
       FROM policy_documents pd ORDER BY pd.created_at DESC`
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/documents", requireWrite("training"), upload.single("file"), async (req, res, next) => {
  try {
    const { docNo, title, version, category, effectiveDate, dueDays } = req.body || {};
    if (!req.file) return res.status(400).json({ error: "PDF dosyası zorunlu." });
    if (!docNo || !title || !version || !category) {
      return res.status(400).json({ error: "Doküman no, başlık, sürüm ve kategori zorunlu." });
    }
    let questions;
    try {
      questions = JSON.parse(req.body.questions || "[]");
    } catch (e) {
      return res.status(400).json({ error: "Sınav soruları hatalı biçimlendirilmiş." });
    }
    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ error: "En az bir sınav sorusu gerekir." });
    }
    for (const q of questions) {
      if (!q.text || !Array.isArray(q.options) || q.options.length < 2 ||
          !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        return res.status(400).json({ error: "Her soru en az 2 şık, metin ve geçerli bir doğru cevap içermelidir." });
      }
    }
    const fileBuf = fs.readFileSync(req.file.path);
    const sha256 = crypto.createHash("sha256").update(fileBuf).digest("hex");
    const defaultDueDays = await getNumberSetting("training_default_due_days");
    const days = Math.max(1, parseInt(dueDays, 10) || defaultDueDays);

    const result = await withTransaction(async (client) => {
      const docRes = await client.query(
        `INSERT INTO policy_documents (doc_no, title, version, category, status, created_by, file_name, file_path, file_sha256, page_count, effective_date)
         VALUES ($1,$2,$3,$4,'yayinda',$5,$6,$7,$8,1,$9) RETURNING id`,
        [docNo.trim(), title.trim(), version.trim(), category.trim(), req.user.username,
         req.file.originalname, req.file.path, sha256, effectiveDate || null]
      );
      const docId = docRes.rows[0].id;
      let pos = 0;
      for (const q of questions) {
        await client.query(
          `INSERT INTO policy_document_questions (policy_document_id, position, question_text, options, correct_index, weight)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [docId, pos++, q.text.trim(), JSON.stringify(q.options.map((o) => String(o).trim())), q.correctIndex, q.weight || 1]
        );
      }
      const { rows: activeUsers } = await client.query("SELECT username, manager_username FROM users WHERE active");
      const dueAt = new Date(Date.now() + days * 24 * 3600 * 1000);
      for (const u of activeUsers) {
        await client.query(
          `INSERT INTO training_assignments (username, policy_document_id, due_at)
           VALUES ($1,$2,$3) ON CONFLICT (username, policy_document_id) DO NOTHING`,
          [u.username, docId, dueAt]
        );
      }
      return { docId, assigned: activeUsers.length, usernames: activeUsers.map((u) => u.username), dueAt };
    });

    await audit(`Zorunlu okuma yayınlandı: ${docNo} v${version} — ${title} (${result.assigned} kişiye atandı)`, req.user.username);
    // Atanan HERKESE "yeni bir eğitiminiz var" bildirimi (şablon tanımlı/aktifse).
    const dueStr = result.dueAt.toISOString().slice(0, 10);
    for (const username of result.usernames) {
      const [email] = await Promise.all([emailOf(username)]);
      await notifyEvent("training.assigned", email, { egitim_adi: title.trim(), son_tarih: dueStr, doc_no: docNo.trim() });
    }
    res.status(201).json({ id: result.docId, assigned: result.assigned });
  } catch (e) {
    next(e);
  }
});

router.get("/documents/:id/file", requireRead("training"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM policy_documents WHERE id=$1", [req.params.id]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    const resolved = path.resolve(doc.file_path);
    if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) return res.status(400).json({ error: "Geçersiz dosya yolu." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${doc.file_name.replace(/[^\w.\-]/g, "_")}"`);
    fs.createReadStream(resolved).pipe(res);
  } catch (e) {
    next(e);
  }
});

// -------------------------- Eğitimi kapatma (emekliye ayırma) --------------------------
// KURAL: yayındaki bir zorunlu okuma dokümanı hiçbir zaman doğrudan düzenlenemez veya
// silinemez (admin dahil) — bu, tamamlamış kullanıcıların kaydını bozmamak içindir.
// Tek yol: yükleyen kişi bir kapatma talebi açar; SIRAYLA önce yöneticisi, SONRA
// Teftiş onaylar (paralel değil — toplam 2 onay, ikisi de gerekli). Herhangi biri
// reddederse talep biter. Onaylanınca doküman GERÇEK anlamda silinmez: durumu
// "kapalı" olur ve tamamlanmamış (henüz bitirilmemiş) atamalar YUMUŞAK şekilde
// iptal edilir (cancelled_at) — DB'den asla silinmez, tamamlanmış kayıtlara hiç dokunulmaz.
router.post("/documents/:id/close-request", requireWrite("training"), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 10) return res.status(400).json({ error: "Gerekçe en az 10 karakter olmalı." });
    const { rows } = await query("SELECT * FROM policy_documents WHERE id=$1", [req.params.id]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (doc.created_by !== req.user.username) return res.status(403).json({ error: "Bu dokümanı yalnızca yükleyen kişi kapatma talebi açabilir." });
    if (doc.status !== "yayinda") return res.status(409).json({ error: "Yalnızca yayındaki bir doküman için kapatma talebi açılabilir." });

    const pending = await query(
      "SELECT 1 FROM approval_requests WHERE kind='training.close' AND target_id=$1 AND status='bekliyor'",
      [doc.id]
    );
    if (pending.rowCount) return res.status(409).json({ error: "Bu doküman için zaten bekleyen bir kapatma talebi var." });

    const me = await query("SELECT manager_username FROM users WHERE username=$1", [req.user.username]);
    const managerUsername = me.rows[0] && me.rows[0].manager_username;
    if (!managerUsername) return res.status(409).json({ error: "Yöneticiniz tanımlı değil, kapatma talebi açılamıyor." });
    const insp = await query(
      "SELECT username FROM users WHERE role='inspection' AND active AND username != $1 ORDER BY username LIMIT 1",
      [req.user.username]
    );
    if (!insp.rowCount) return res.status(409).json({ error: "Tanımlı bir Teftiş kullanıcısı yok, kapatma talebi açılamıyor." });

    const subject = `${doc.doc_no} v${doc.version} — ${doc.title}`;
    // Yalnızca 1. adım (yönetici) burada açılır; Teftiş adımı yönetici onaylayınca otomatik açılır.
    await query(
      `INSERT INTO approval_requests (kind, subject, category, target_type, target_id, requested_by, approver, reason, step, total_steps)
       VALUES ('training.close',$1,'Genel','policy_document',$2,$3,$4,$5,1,2)`,
      [subject, doc.id, req.user.username, managerUsername, reason.trim()]
    );
    await audit(`Eğitim kapatma talebi açıldı (1/2 — yönetici onayı bekleniyor): ${subject}`, req.user.username,
      true, { actionType: "silme", approvers: [managerUsername] });
    await notifyApprovalCreated({ requestedBy: req.user.username, approver: managerUsername, subject, kind: "Eğitim kapatma" });
    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
