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
      }
    });
    await audit(`Talep ${decision === "onayla" ? "onaylandı" : "reddedildi"}: #${reqRow.id} ${reqRow.subject}`, req.user.username);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
