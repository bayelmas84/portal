"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { query, withTransaction } = require("../db");
const { requireRead, requireWrite, requireAuth } = require("../middleware/auth");
const { canWrite, MEETING_ALWAYS_ROLES } = require("../lib/permissions");
const { audit } = require("../lib/audit");
const { sendMail } = require("../lib/mailer");
const { config } = require("../config");

const router = express.Router();

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.uploadMaxMb * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") return cb(new Error("Yalnızca PDF kabul edilir."));
    cb(null, true);
  },
});

const DOC_TYPE_ORDER = ["Proje Kartı", "BRD", "FRD", "UAT", "Go Live", "Risk ve Uyumluluk", "Kapanış"];
const APPROVAL_STEPS = [
  { no: 1, name: "Ürün Sahibi" },
  { no: 2, name: "İş Birimi Sahibi" },
  { no: 3, name: "Ürün Sahibi'nin yöneticisi" },
  { no: 4, name: "İş Birimi Sahibi'nin yöneticisi" },
  { no: 5, name: "Teftiş" },
  { no: 6, name: "Kurumsal Risk Grup Direktörü" },
];

async function ensureMandatoryTeam(projectK) {
  // Teftiş ve Kurumsal Risk her projede zorunlu üyedir.
  const insp = await query("SELECT username FROM users WHERE role='inspection' AND active LIMIT 1");
  const risk = await query("SELECT username FROM users WHERE role='control' AND active LIMIT 1");
  for (const [row, roleLabel] of [[insp.rows[0], "Internal Audit"], [risk.rows[0], "Risk"]]) {
    if (row) {
      await query(
        `INSERT INTO project_team (project_k, username, project_role, mandatory)
         VALUES ($1,$2,$3,true) ON CONFLICT (project_k, username) DO NOTHING`,
        [projectK, row.username, roleLabel]
      );
    }
  }
}

router.get("/", requireRead("d.team"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM projects ORDER BY k");
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// ---------------------------------- Ekip ----------------------------------
// Ekip listesi kimin PO/BO/onaycı olduğunu belirlemek için proje yönetimi dışındaki
// ekranlarda da (ör. doküman onay zinciri) gerekir; bu bilgi hassas değildir,
// bu yüzden d.team yazma yetkisi olmayan herkes de görebilir (yalnızca oturum açık olmalı).
router.get("/:k/team", requireAuth, async (req, res, next) => {
  try {
    await ensureMandatoryTeam(req.params.k);
    const { rows } = await query(
      `SELECT pt.*, u.name, u.title, u.unit FROM project_team pt
       JOIN users u ON u.username = pt.username WHERE pt.project_k=$1 ORDER BY pt.mandatory, u.name`,
      [req.params.k]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/:k/team", requireWrite("d.team"), async (req, res, next) => {
  try {
    const { username, projectRole } = req.body || {};
    if (!username || !projectRole) return res.status(400).json({ error: "Kişi ve proje rolü zorunlu." });
    await query(
      `INSERT INTO project_team (project_k, username, project_role) VALUES ($1,$2,$3)
       ON CONFLICT (project_k, username) DO UPDATE SET project_role=$3`,
      [req.params.k, username, projectRole]
    );
    await audit(`Proje ekibine eklendi: ${username} (${projectRole}) — ${req.params.k}`, req.user.username);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete("/:k/team/:username", requireWrite("d.team"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT mandatory FROM project_team WHERE project_k=$1 AND username=$2",
      [req.params.k, req.params.username]
    );
    if (!rows.length) return res.status(404).json({ error: "Üye bulunamadı." });
    if (rows[0].mandatory) return res.status(409).json({ error: "Zorunlu üye çıkarılamaz." });
    await query("DELETE FROM project_team WHERE project_k=$1 AND username=$2", [req.params.k, req.params.username]);
    await audit(`Proje ekibinden çıkarıldı: ${req.params.username} — ${req.params.k}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ------------------------------- Dokümanlar --------------------------------
function nextStepFor(pr) {
  const idx = DOC_TYPE_ORDER.indexOf(pr.doc_type);
  return idx;
}

router.get("/:k/documents", requireRead("d.docs"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM project_documents WHERE project_k=$1 ORDER BY uploaded_at",
      [req.params.k]
    );
    const out = [];
    for (const d of rows) {
      const appr = await query(
        `SELECT pda.step_no, pda.step_name, pda.approver_username, pda.is_proxy, pda.approved_at, u.name, u.title
         FROM project_document_approvals pda JOIN users u ON u.username=pda.approver_username
         WHERE pda.document_id=$1 ORDER BY pda.step_no`,
        [d.id]
      );
      out.push({ ...d, approvals: appr.rows });
    }
    res.json({ items: out });
  } catch (e) { next(e); }
});

function uploadPdf(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Dosya yüklenemedi." });
    next();
  });
}

router.post("/:k/documents", requireWrite("d.docs"), uploadPdf, async (req, res, next) => {
  try {
    const { docType, title } = req.body || {};
    if (!req.file) return res.status(400).json({ error: "PDF dosyası zorunlu." });
    if (!DOC_TYPE_ORDER.includes(docType)) return res.status(400).json({ error: "Geçersiz doküman tipi." });
    const idx = DOC_TYPE_ORDER.indexOf(docType);
    if (idx > 0) {
      const prevType = DOC_TYPE_ORDER[idx - 1];
      const prev = await query(
        "SELECT status FROM project_documents WHERE project_k=$1 AND doc_type=$2",
        [req.params.k, prevType]
      );
      if (!prev.rowCount || prev.rows[0].status !== "onaylandi") {
        return res.status(409).json({ error: `${prevType} tamamen onaylanmadan ${docType} yüklenemez.` });
      }
    }
    const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const storedName = `${crypto.randomBytes(16).toString("hex")}.pdf`;
    const fullPath = path.join(config.uploadDir, storedName);
    fs.writeFileSync(fullPath, req.file.buffer);

    const { rows } = await query(
      `INSERT INTO project_documents (project_k, doc_type, title, file_name, file_path, file_sha256, page_count, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (project_k, doc_type) DO UPDATE SET
         title=$3, file_name=$4, file_path=$5, file_sha256=$6, page_count=$7, uploaded_by=$8,
         status='onay_akisinda', current_step=1, uploaded_at=now(), reject_reason=NULL
       RETURNING id, project_k, doc_type, title, file_name, status, current_step, uploaded_by, uploaded_at`,
      [req.params.k, docType, title || req.file.originalname, req.file.originalname, storedName, sha256, 1, req.user.username]
    );
    await query("DELETE FROM project_document_approvals WHERE document_id=$1", [rows[0].id]);
    await audit(`Proje dokümanı yüklendi: ${docType} — ${req.params.k} (${sha256.slice(0, 12)}…)`, req.user.username);
    res.status(201).json({ item: rows[0] });
  } catch (e) {
    if (e.message === "Yalnızca PDF kabul edilir.") return res.status(400).json({ error: e.message });
    next(e);
  }
});

// Dosyanın kendisi: yalnızca ilgili projeye erişimi olanlar indirebilir; dosya
// adı path traversal'a karşı önce diskteki gerçek (rastgele üretilmiş) ada
// çevrilir, kullanıcıdan gelen değer asla doğrudan dosya yoluna eklenmez.
router.get("/:k/documents/:docId/file", requireRead("d.docview"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM project_documents WHERE id=$1 AND project_k=$2", [
      req.params.docId, req.params.k,
    ]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (!/^[a-f0-9]{32}\.pdf$/.test(doc.file_path)) return res.status(400).json({ error: "Geçersiz dosya kaydı." });
    const abs = path.resolve(config.uploadDir, doc.file_path);
    if (!abs.startsWith(path.resolve(config.uploadDir) + path.sep)) return res.status(400).json({ error: "Geçersiz yol." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${doc.doc_type.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(abs);
  } catch (e) { next(e); }
});

async function resolveApprover(stepNo, projectK) {
  const team = await query("SELECT username, project_role FROM project_team WHERE project_k=$1", [projectK]);
  const byRole = (role) => (team.rows.find((t) => t.project_role === role) || {}).username;
  if (stepNo === 1) return byRole("Product Owner");
  if (stepNo === 2) return byRole("Business Owner");
  if (stepNo === 3 || stepNo === 4) {
    const base = stepNo === 3 ? byRole("Product Owner") : byRole("Business Owner");
    if (!base) return null;
    const u = await query("SELECT manager_username FROM users WHERE username=$1", [base]);
    return u.rows[0] ? u.rows[0].manager_username : null;
  }
  if (stepNo === 5) return byRole("Internal Audit");
  if (stepNo === 6) {
    const u = await query("SELECT username FROM users WHERE role='control' AND title='GDIR' AND active LIMIT 1");
    return u.rows[0] ? u.rows[0].username : null;
  }
  return null;
}

router.post("/:k/documents/:docId/approve", requireRead("d.docview"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM project_documents WHERE id=$1 AND project_k=$2", [
      req.params.docId, req.params.k,
    ]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (doc.status !== "onay_akisinda") return res.status(409).json({ error: "Bu doküman onay akışında değil." });

    const step = APPROVAL_STEPS.find((s) => s.no === doc.current_step);
    const expected = await resolveApprover(step.no, req.params.k);
    let isProxy = false;
    let approver = req.user.username;
    if (expected && expected !== req.user.username) {
      return res.status(403).json({ error: "Bu adımı yalnızca beklenen kişi onaylayabilir." });
    }
    if (!expected) {
      // Beklenen kişi çözülemiyorsa yalnızca Proje Yönetim Direktörü vekaleten onaylar.
      if (req.user.role !== "pmdir") return res.status(409).json({ error: "Bu adımda kimse atanmamış; yalnızca Proje Yönetim Direktörü vekaleten onaylayabilir." });
      isProxy = true;
    }

    const result = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO project_document_approvals (document_id, step_no, step_name, approver_username, is_proxy)
         VALUES ($1,$2,$3,$4,$5)`,
        [doc.id, step.no, step.name, approver, isProxy]
      );
      const finished = step.no === 6;
      await client.query(
        `UPDATE project_documents SET current_step=$1, status=$2 WHERE id=$3`,
        [finished ? 6 : step.no + 1, finished ? "onaylandi" : "onay_akisinda", doc.id]
      );
      return { finished };
    });
    await audit(`Doküman onay adımı ${step.no} (${step.name}) tamamlandı${isProxy ? " (vekaleten)" : ""} — ${doc.doc_type}/${req.params.k}`, req.user.username);
    res.json({ step: step.no, finished: result.finished });
  } catch (e) { next(e); }
});

router.post("/:k/documents/:docId/reject", requireRead("d.docview"), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 5) return res.status(400).json({ error: "Ret gerekçesi en az 5 karakter olmalı." });
    const { rows } = await query("SELECT * FROM project_documents WHERE id=$1 AND project_k=$2", [req.params.docId, req.params.k]);
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Doküman bulunamadı." });
    if (doc.status !== "onay_akisinda") return res.status(409).json({ error: "Bu doküman onay akışında değil." });
    await query("UPDATE project_documents SET status='reddedildi', reject_reason=$1 WHERE id=$2", [reason.trim(), doc.id]);
    await audit(`Proje dokümanı reddedildi: ${doc.doc_type} — ${req.params.k} (${reason.trim()})`, req.user.username, false);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --------------------------- Değişiklik talepleri ---------------------------
router.get("/:k/change-requests", requireRead("d.cr"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM change_requests WHERE project_k=$1 ORDER BY created_at DESC", [req.params.k]);
    const out = [];
    for (const cr of rows) {
      const appr = await query(
        `SELECT cra.username, cra.capacity, cra.approved_at, u.name, u.title
         FROM change_request_approvals cra JOIN users u ON u.username=cra.username
         WHERE cra.change_request_id=$1 ORDER BY cra.approved_at`,
        [cr.id]
      );
      out.push({ ...cr, approvals: appr.rows });
    }
    res.json({ items: out });
  } catch (e) { next(e); }
});

router.post("/:k/change-requests", requireWrite("d.cr"), async (req, res, next) => {
  try {
    const { title, reason, impact } = req.body || {};
    if (!title || title.trim().length < 5) return res.status(400).json({ error: "Başlık en az 5 karakter olmalı." });
    const count = await query("SELECT COUNT(*)::int AS n FROM change_requests WHERE project_k=$1", [req.params.k]);
    const no = `CR-${String(count.rows[0].n + 1).padStart(3, "0")}`;
    const { rows } = await query(
      `INSERT INTO change_requests (project_k, no, title, reason, impact, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.k, no, title.trim(), reason || "", impact || "", req.user.username]
    );
    await audit(`Değişiklik talebi oluşturuldu: ${no} — ${req.params.k}`, req.user.username);
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.post("/:k/change-requests/:id/approve", requireRead("d.cr"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM change_requests WHERE id=$1 AND project_k=$2", [req.params.id, req.params.k]);
    const cr = rows[0];
    if (!cr) return res.status(404).json({ error: "Değişiklik talebi bulunamadı." });
    if (cr.status !== "onayda") return res.status(409).json({ error: "Bu talep onay bekleyen durumda değil." });
    if (cr.created_by === req.user.username) return res.status(409).json({ error: "Kendi talebinizi onaylayamazsınız." });

    // Sunucu, istemcinin bildirdiği sıfatı (manager/team) körü körüne kabul
    // etmez: talebi açanın yöneticisi mi, yoksa proje ekibinde mi olduğunu
    // kendisi doğrular (Proje Yönetim Direktörü her iki sıfatla da onaylayabilir).
    const creator = await query("SELECT manager_username FROM users WHERE username=$1", [cr.created_by]);
    const isManager = req.user.role === "pmdir" || (creator.rows[0] && creator.rows[0].manager_username === req.user.username);
    const team = await query("SELECT 1 FROM project_team WHERE project_k=$1 AND username=$2", [req.params.k, req.user.username]);
    const isTeam = req.user.role === "pmdir" || team.rowCount > 0;

    const existing = await query("SELECT DISTINCT capacity FROM change_request_approvals WHERE change_request_id=$1", [cr.id]);
    const have = existing.rows.map((r) => r.capacity);
    const needManager = !have.includes("manager");
    const needTeam = !have.includes("team");
    let capacity = null;
    if (needManager && isManager) capacity = "manager";
    else if (needTeam && isTeam) capacity = "team";
    if (!capacity) {
      return res.status(403).json({
        error: needManager
          ? "Bu talebi açan kişinin yöneticisi henüz onaylamadı; önce o onaylamalı."
          : "Proje ekibinden birinin onayı gerekiyor; bu sıfatla onay veremezsiniz.",
      });
    }

    await query(
      `INSERT INTO change_request_approvals (change_request_id, username, capacity) VALUES ($1,$2,$3)`,
      [cr.id, req.user.username, capacity]
    );
    const approvals = await query("SELECT DISTINCT capacity FROM change_request_approvals WHERE change_request_id=$1", [cr.id]);
    const capacities = approvals.rows.map((r) => r.capacity);
    const fullyApproved = capacities.includes("manager") && capacities.includes("team");
    if (fullyApproved) {
      await query("UPDATE change_requests SET status='onaylandi' WHERE id=$1", [cr.id]);
    }
    await audit(`Değişiklik talebi onayı (${capacity}): ${cr.no}${fullyApproved ? " — tam onaylandı" : ""}`, req.user.username);
    res.json({ ok: true, capacity, fullyApproved });
  } catch (e) { next(e); }
});

router.post("/:k/change-requests/:id/reject", requireRead("d.cr"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM change_requests WHERE id=$1 AND project_k=$2", [req.params.id, req.params.k]);
    const cr = rows[0];
    if (!cr) return res.status(404).json({ error: "Değişiklik talebi bulunamadı." });
    if (cr.created_by === req.user.username) return res.status(409).json({ error: "Kendi talebinizi reddedemezsiniz." });
    await query("UPDATE change_requests SET status='reddedildi' WHERE id=$1", [cr.id]);
    await audit(`Değişiklik talebi reddedildi: ${cr.no}`, req.user.username, false);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ------------------------------ Toplantı notları ----------------------------
function canSeeMeeting(role, username, participants, createdByWrite) {
  if (MEETING_ALWAYS_ROLES.includes(role)) return true;
  if (createdByWrite) return true; // pm/pmdir tüm notları görür
  return participants.includes(username);
}

router.get("/meetings", requireRead("d.meeting"), async (req, res, next) => {
  try {
    const projFilter = req.query.project || "ALL";
    const { rows: meetings } = await query(
      `SELECT * FROM meetings WHERE ($1='ALL' OR project_k=$1) ORDER BY meeting_date DESC, id DESC`,
      [projFilter]
    );
    const canWriteMeetings = await canWrite(req.user.role, "d.meeting");
    const out = [];
    for (const m of meetings) {
      const parts = await query("SELECT username FROM meeting_participants WHERE meeting_id=$1", [m.id]);
      const participantNames = parts.rows.map((p) => p.username);
      if (!canSeeMeeting(req.user.role, req.user.username, participantNames, canWriteMeetings)) continue;
      const items = await query("SELECT * FROM meeting_items WHERE meeting_id=$1", [m.id]);
      out.push({ ...m, participants: participantNames, items: items.rows });
    }
    res.json({ items: out });
  } catch (e) { next(e); }
});

router.post("/meetings", requireWrite("d.meeting"), async (req, res, next) => {
  try {
    const { projectK, otherSubject, title, date, time, notes, participants, items } = req.body || {};
    if (!projectK && !otherSubject) return res.status(400).json({ error: "Proje veya toplantı konusu (Diğer) zorunlu." });
    if (!date) return res.status(400).json({ error: "Tarih zorunlu." });
    if (!Array.isArray(participants) || !participants.length) return res.status(400).json({ error: "En az bir katılımcı gerekli." });

    const meeting = await withTransaction(async (client) => {
      const m = await client.query(
        `INSERT INTO meetings (project_k, project_other_subject, title, meeting_date, meeting_time, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [projectK || null, projectK ? null : otherSubject, title || otherSubject || "Toplantı Notu", date, time || null, notes || null, req.user.username]
      );
      for (const p of participants) {
        await client.query("INSERT INTO meeting_participants (meeting_id, username) VALUES ($1,$2)", [m.rows[0].id, p]);
      }
      for (const it of items || []) {
        await client.query(
          "INSERT INTO meeting_items (meeting_id, text, status, carried_from_meeting_id) VALUES ($1,$2,'open',$3)",
          [m.rows[0].id, it.text, it.carriedFromMeetingId || null]
        );
      }
      if (projectK) {
        await client.query("DELETE FROM meeting_carry_queue WHERE project_k=$1", [projectK]);
      }
      return m.rows[0];
    });

    const users = await query("SELECT username, email FROM users WHERE username = ANY($1)", [participants]);
    let sentCount = 0;
    for (const u of users.rows) {
      const ok = await sendMail(u.email, `${meeting.title} — toplantı notu paylaşıldı`, "Toplantı notu portalda yayınlandı.");
      if (ok) sentCount += 1;
    }
    await audit(`Toplantı notu oluşturuldu: ${meeting.title} · bildirim: ${sentCount}/${users.rowCount}`, req.user.username);
    res.status(201).json({ item: meeting, mailSent: sentCount, mailTotal: users.rowCount });
  } catch (e) { next(e); }
});

router.post("/meetings/:id/items/:itemId/status", requireWrite("d.meeting"), async (req, res, next) => {
  try {
    const { status } = req.body || {}; // 'open' | 'done' | 'cancelled' | 'carried'
    if (!["open", "done", "cancelled", "carried"].includes(status)) {
      return res.status(400).json({ error: "Geçersiz durum." });
    }
    const item = await query("SELECT * FROM meeting_items WHERE id=$1 AND meeting_id=$2", [req.params.itemId, req.params.id]);
    if (!item.rowCount) return res.status(404).json({ error: "Madde bulunamadı." });
    await query("UPDATE meeting_items SET status=$1 WHERE id=$2", [status, req.params.itemId]);

    if (status === "carried") {
      const m = await query("SELECT project_k FROM meetings WHERE id=$1", [req.params.id]);
      if (m.rows[0].project_k) {
        await query(
          "INSERT INTO meeting_carry_queue (project_k, text, from_meeting_id) VALUES ($1,$2,$3)",
          [m.rows[0].project_k, item.rows[0].text, req.params.id]
        );
      }
    } else {
      await query("DELETE FROM meeting_carry_queue WHERE from_meeting_id=$1 AND text=$2", [req.params.id, item.rows[0].text]);
    }
    await audit(`Toplantı maddesi durumu değişti: #${req.params.itemId} -> ${status}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/:k/meetings/carry-queue", requireRead("d.meeting"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM meeting_carry_queue WHERE project_k=$1 ORDER BY created_at", [req.params.k]);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// ---------------------------------- Gantt -----------------------------------
router.get("/:k/gantt", requireRead("d.gantt"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM gantt_tasks WHERE project_k=$1 ORDER BY start_date", [req.params.k]);
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/:k/gantt", requireWrite("d.gantt"), async (req, res, next) => {
  try {
    const { name, startDate, endDate, progress } = req.body || {};
    if (!name || !startDate || !endDate) return res.status(400).json({ error: "Görev adı, başlangıç ve bitiş tarihi zorunlu." });
    const { rows } = await query(
      `INSERT INTO gantt_tasks (project_k, name, start_date, end_date, progress, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.params.k, name, startDate, endDate, progress || 0, req.user.username]
    );
    await audit(`Gantt görevi eklendi: ${name} — ${req.params.k}`, req.user.username);
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:k/gantt/:id", requireWrite("d.gantt"), async (req, res, next) => {
  try {
    await query("DELETE FROM gantt_tasks WHERE id=$1 AND project_k=$2", [req.params.id, req.params.k]);
    await audit(`Gantt görevi silindi: #${req.params.id} — ${req.params.k}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
