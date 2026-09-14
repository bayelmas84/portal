"use strict";
const express = require("express");
const { query, withTransaction } = require("../db");
const { requireRead, requireWrite } = require("../middleware/auth");
const { audit } = require("../lib/audit");

const router = express.Router();

function approverFor(category, requesterManager) {
  // Yasal -> Teftiş; Genel -> girenin yöneticisi. Teftiş kullanıcı adını admin
  // tablo sorgusuyla (role='inspection') buluruz; birden fazla varsa ilkini alır.
  return category === "Yasal" ? null /* çözülür aşağıda */ : requesterManager;
}

router.get("/", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, EXISTS(
         SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.username=$1
       ) AS read_by_me
       FROM announcements a
       WHERE a.status='yayinda' OR a.created_by=$1
       ORDER BY a.created_at DESC`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/", requireWrite("announcements"), async (req, res, next) => {
  try {
    const { title, body, category, criticality, validUntil, popup } = req.body || {};
    if (!title || title.trim().length < 5) return res.status(400).json({ error: "Başlık en az 5 karakter olmalı." });
    if (!body || !body.trim()) return res.status(400).json({ error: "Metin zorunlu." });
    if (!["Yasal", "Genel"].includes(category)) return res.status(400).json({ error: "Geçersiz kategori." });

    let approver;
    if (category === "Yasal") {
      const insp = await query("SELECT username FROM users WHERE role='inspection' AND active ORDER BY username LIMIT 1");
      if (!insp.rowCount) return res.status(409).json({ error: "Tanımlı bir Teftiş kullanıcısı yok." });
      approver = insp.rows[0].username;
    } else {
      if (!req.user.manager_username) return res.status(409).json({ error: "Yöneticiniz tanımlı değil, onaya gönderilemiyor." });
      approver = req.user.manager_username;
    }

    const result = await withTransaction(async (client) => {
      const ann = await client.query(
        `INSERT INTO announcements (title, body, category, criticality, valid_until, popup, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'onayda',$7) RETURNING *`,
        [title.trim(), body.trim(), category, criticality || "Orta", validUntil || null, !!popup, req.user.username]
      );
      await client.query(
        `INSERT INTO approval_requests (kind, subject, category, target_type, target_id, requested_by, approver)
         VALUES ('ann.publish',$1,$2,'announcement',$3,$4,$5)`,
        [title.trim(), category, ann.rows[0].id, req.user.username, approver]
      );
      return ann.rows[0];
    });
    await audit(`Duyuru onaya gönderildi: ${title.trim()} (onaycı: ${approver})`, req.user.username);
    res.status(201).json({ item: result });
  } catch (e) {
    next(e);
  }
});

// Yayındaki bir duyuru için silme talebi: yalnızca giren kişi veya Teftiş açabilir,
// zaten bekleyen bir silme talebi varsa ikinci bir tane açılmaz.
router.post("/:id/delete-request", requireWrite("announcements"), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 10) return res.status(400).json({ error: "Gerekçe en az 10 karakter olmalı." });
    const { rows } = await query("SELECT * FROM announcements WHERE id=$1", [req.params.id]);
    const ann = rows[0];
    if (!ann) return res.status(404).json({ error: "Duyuru bulunamadı." });
    if (ann.status !== "yayinda") return res.status(409).json({ error: "Yalnızca yayındaki duyurular için silme talebi açılabilir." });
    const isOwner = ann.created_by === req.user.username;
    const isInspector = req.user.role === "inspection";
    if (!isOwner && !isInspector) return res.status(403).json({ error: "Bu duyuruyu silme talebi açma yetkiniz yok." });

    const pending = await query(
      "SELECT 1 FROM approval_requests WHERE kind='ann.delete' AND target_id=$1 AND status='bekliyor'",
      [ann.id]
    );
    if (pending.rowCount) return res.status(409).json({ error: "Bu duyuru için zaten bekleyen bir silme talebi var." });

    let approver;
    if (ann.category === "Yasal") {
      const insp = await query("SELECT username FROM users WHERE role='inspection' AND active AND username != $1 ORDER BY username LIMIT 1", [req.user.username]);
      if (!insp.rowCount) return res.status(409).json({ error: "Tanımlı başka bir Teftiş kullanıcısı yok." });
      approver = insp.rows[0].username;
    } else {
      if (!req.user.manager_username) return res.status(409).json({ error: "Yöneticiniz tanımlı değil, onaya gönderilemiyor." });
      approver = req.user.manager_username;
    }

    await query(
      `INSERT INTO approval_requests (kind, subject, category, target_type, target_id, requested_by, approver, reason)
       VALUES ('ann.delete',$1,$2,'announcement',$3,$4,$5,$6)`,
      [ann.title, ann.category, ann.id, req.user.username, approver, reason.trim()]
    );
    await audit(`Duyuru silme talebi açıldı: ${ann.title} (onaycı: ${approver})`, req.user.username);
    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/read", requireRead("announcements"), async (req, res, next) => {
  try {
    await query(
      `INSERT INTO announcement_reads (announcement_id, username) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.username]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Onay kutusu: bana onay bekleyen talepler
router.get("/requests/inbox", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM approval_requests WHERE approver=$1 AND status='bekliyor' ORDER BY created_at`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

// Onay kutusu: benim açtığım ve hâlâ bekleyen talepler
router.get("/requests/mine", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM approval_requests WHERE requested_by=$1 AND status='bekliyor' ORDER BY created_at DESC`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

// Onay kutusu: karara bağladığım talepler (onayladığım veya reddettiğim)
router.get("/requests/done", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM approval_requests WHERE approver=$1 AND status IN ('onaylandi','reddedildi') ORDER BY decided_at DESC`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/requests/:id/decide", requireRead("announcements"), async (req, res, next) => {
  try {
    const { decision, reason } = req.body || {}; // 'onayla' | 'reddet'
    const { rows } = await query("SELECT * FROM approval_requests WHERE id=$1", [req.params.id]);
    const reqRow = rows[0];
    if (!reqRow) return res.status(404).json({ error: "Talep bulunamadı." });
    if (reqRow.approver !== req.user.username) return res.status(403).json({ error: "Bu talebi onaylama yetkiniz yok." });
    if (reqRow.status !== "bekliyor") return res.status(409).json({ error: "Bu talep zaten karara bağlanmış." });
    if (reqRow.requested_by === req.user.username) {
      return res.status(409).json({ error: "Kimse kendi talebini onaylayamaz." });
    }

    await withTransaction(async (client) => {
      const status = decision === "onayla" ? "onaylandi" : "reddedildi";
      await client.query(
        "UPDATE approval_requests SET status=$1, decision_reason=$2, decided_at=now() WHERE id=$3",
        [status, reason || null, reqRow.id]
      );
      if (reqRow.kind === "ann.publish") {
        const newStatus = decision === "onayla" ? "yayinda" : "geri_cekildi";
        await client.query("UPDATE announcements SET status=$1 WHERE id=$2", [newStatus, reqRow.target_id]);
      } else if (reqRow.kind === "ann.delete") {
        if (decision === "onayla") {
          await client.query("DELETE FROM announcements WHERE id=$1", [reqRow.target_id]);
        }
        // reddedilirse duyuru "yayinda" durumunda kalmaya devam eder, ekstra işlem gerekmez.
      } else if (reqRow.kind === "training.close") {
        // İKİ imza gerekir (yönetici + Teftiş). Biri reddederse kardeş talep de düşer.
        // İkisi de onaylanınca doküman GERÇEKTEN kapanır ve tamamlanmamış atamalar silinir
        // (tamamlanmış kayıtlar — sınav geçmişi — asla dokunulmaz, kalıcı kalır).
        if (decision !== "onayla") {
          await client.query(
            `UPDATE approval_requests SET status='geri_cekildi', decision_reason=$1, decided_at=now()
             WHERE kind='training.close' AND target_id=$2 AND status='bekliyor'`,
            [`Diğer onaycı reddetti: ${reason || ""}`.trim(), reqRow.target_id]
          );
        } else {
          const remaining = await client.query(
            "SELECT 1 FROM approval_requests WHERE kind='training.close' AND target_id=$1 AND status='bekliyor'",
            [reqRow.target_id]
          );
          if (!remaining.rowCount) {
            await client.query(
              "UPDATE policy_documents SET status='kapali', closed_at=now(), closed_reason=$1 WHERE id=$2",
              [reqRow.reason, reqRow.target_id]
            );
            await client.query(
              "DELETE FROM training_assignments WHERE policy_document_id=$1 AND completed_at IS NULL",
              [reqRow.target_id]
            );
          }
        }
      }
    });
    await audit(`Talep ${decision === "onayla" ? "onaylandı" : "reddedildi"}: #${reqRow.id} ${reqRow.subject}`, req.user.username);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
