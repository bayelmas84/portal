"use strict";
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const notify = require("../services/notify");
const { requireScreen } = require("../middleware/auth");

module.exports = function (cfg) {
  const r = express.Router();

  /* Sorgular sabittir; kolon listesi bile şablon değişkeniyle üretilmez. */
  const SQL_INBOX = `SELECT id, kind, subject, category, requested_by, approver, status, reason,
                            target_type, target_id, created_at, decided_by, decided_at, decision_reason
                       FROM requests WHERE approver = $1 AND status = 'bekliyor' ORDER BY created_at ASC`;
  const SQL_MINE = `SELECT id, kind, subject, category, requested_by, approver, status, reason,
                           target_type, target_id, created_at, decided_by, decided_at, decision_reason
                      FROM requests WHERE requested_by = $1 ORDER BY created_at DESC`;
  const SQL_DECIDED = `SELECT id, kind, subject, category, requested_by, approver, status, reason,
                              target_type, target_id, created_at, decided_by, decided_at, decision_reason
                         FROM requests WHERE decided_by = $1 ORDER BY decided_at DESC`;
  const SQL_ONE = `SELECT id, kind, subject, category, requested_by, approver, status, reason,
                          target_type, target_id, created_at, decided_by, decided_at, decision_reason
                     FROM requests WHERE id = $1`;

  r.get("/inbox", requireScreen("p.in"), async (req, res) => {
    res.json({ items: await db.many(SQL_INBOX, [req.user.username]) });
  });

  r.get("/mine", requireScreen("p.my"), async (req, res) => {
    res.json({ items: await db.many(SQL_MINE, [req.user.username]) });
  });

  r.get("/decided", requireScreen("p.done"), async (req, res) => {
    res.json({ items: await db.many(SQL_DECIDED, [req.user.username]) });
  });

  /* Talebi yalnızca ilgili taraf görebilir. */
  r.get("/:id", requireScreen("p.in"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const q = await db.one(SQL_ONE, [id]);
      if (!q) return res.status(404).json({ error: "Bulunamadı" });
      if (q.approver !== req.user.username && q.requested_by !== req.user.username && q.decided_by !== req.user.username)
        return res.status(404).json({ error: "Bulunamadı" });
      res.json({ item: q });
    } catch (e) { next(e); }
  });

  async function applyApproval(q, actor) {
    if (q.kind === "ann.publish") {
      await db.query("UPDATE announcements SET status='yayinda', published_at=now() WHERE id=$1", [Number(q.target_id)]);
      await notify.send("ann.approve", { subject: `Duyuru yayına alındı: ${q.subject}`, requester: q.requested_by, approver: actor }, cfg, actor);
    } else if (q.kind === "ann.delete") {
      await db.query("DELETE FROM announcements WHERE id=$1", [Number(q.target_id)]);
      await notify.send("ann.delete.done", { subject: `Duyuru kaldırıldı: ${q.subject}`, requester: q.requested_by, approver: actor }, cfg, actor);
    } else if (q.kind === "doc.publish") {
      await db.query("UPDATE documents SET status='yayinda', effective_date=CURRENT_DATE, reject_reason=NULL WHERE id=$1", [Number(q.target_id)]);
      const d = await db.one("SELECT doc_no, version FROM documents WHERE id=$1", [Number(q.target_id)]);
      /* Yayına giren doküman tüm aktif kullanıcılara zorunlu okuma olarak atanır. */
      await require("../lib/training").assignToAll(d.doc_no, cfg.READING_DUE_DAYS, actor);
      /* Yeni sürüm yayına girdiğinde önceki sürümün onayları geçersizdir (kayıt silinmez, sürüm bazlıdır). */
      await notify.send("doc.approve", { subject: `${q.subject} yayına alındı (v${d.version})`, requester: q.requested_by, approver: actor }, cfg, actor);
    } else if (q.kind === "report.publish") {
      await db.query(
        `UPDATE bi_reports SET status='yayinda', published_at=now(), version=version+1, reject_reason=NULL
          WHERE id=$1`, [Number(q.target_id)]);
      await notify.send("report.approve", { subject: `${q.subject} yayına alındı`, requester: q.requested_by, approver: actor }, cfg, actor);
    } else if (q.kind === "report.retire") {
      await db.query("UPDATE bi_reports SET status='emekli', retired_at=now() WHERE id=$1", [Number(q.target_id)]);
      await notify.send("report.retire", { subject: `${q.subject} emekliye alındı`, requester: q.requested_by, approver: actor }, cfg, actor);
    } else if (q.kind === "doc.delete") {
      await db.query("DELETE FROM documents WHERE id=$1", [Number(q.target_id)]);
      await notify.send("doc.deleted", { subject: `${q.subject} yayından kaldırıldı`, requester: q.requested_by, approver: actor }, cfg, actor);
    }
  }

  r.post("/:id/approve", requireScreen("p.in", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const q = await db.one("SELECT * FROM requests WHERE id=$1", [id]);
      if (!q) return res.status(404).json({ error: "Bulunamadı" });
      if (q.status !== "bekliyor") return res.status(409).json({ error: "Talep zaten sonuçlanmış" });
      if (q.approver !== req.user.username) return res.status(403).json({ error: "Bu talep sizin onayınızda değil" });
      /* Doküman ve rapor talepleri yalnızca Teftiş rolünde karara bağlanır. */
      if ((q.kind.startsWith("doc.") || q.kind.startsWith("report.")) && req.user.role_key !== "inspection")
        return res.status(403).json({ error: "Bu onay yalnızca Teftiş rolündedir" });
      /* Görevler ayrılığı: kimse kendi talebini onaylayamaz. */
      if (q.requested_by === req.user.username)
        return res.status(403).json({ error: "Kendi talebinizi onaylayamazsınız" });

      await db.query("UPDATE requests SET status='onaylandi', decided_by=$1, decided_at=now() WHERE id=$2",
        [req.user.username, id]);
      await applyApproval(q, req.user.username);
      await audit.record("talep.onaylandi", req.user.username, { detail: { id, tur: q.kind, konu: q.subject, talep_eden: q.requested_by } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.post("/:id/reject", requireScreen("p.in", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const reason = z.string().trim().min(10).max(2000).parse(req.body.reason);
      const q = await db.one("SELECT * FROM requests WHERE id=$1", [id]);
      if (!q) return res.status(404).json({ error: "Bulunamadı" });
      if (q.status !== "bekliyor") return res.status(409).json({ error: "Talep zaten sonuçlanmış" });
      if (q.approver !== req.user.username) return res.status(403).json({ error: "Bu talep sizin onayınızda değil" });
      if ((q.kind.startsWith("doc.") || q.kind.startsWith("report.")) && req.user.role_key !== "inspection")
        return res.status(403).json({ error: "Bu ret yalnızca Teftiş rolündedir" });

      await db.query("UPDATE requests SET status='reddedildi', decided_by=$1, decided_at=now(), decision_reason=$2 WHERE id=$3",
        [req.user.username, reason, id]);
      if (q.kind === "ann.publish") await db.query("UPDATE announcements SET status='reddedildi' WHERE id=$1", [Number(q.target_id)]);
      if (q.kind === "doc.publish") await db.query("UPDATE documents SET status='reddedildi', reject_reason=$1 WHERE id=$2", [reason, Number(q.target_id)]);
      if (q.kind === "doc.delete") await db.query("UPDATE documents SET pending_delete=FALSE WHERE id=$1", [Number(q.target_id)]);
      if (q.kind === "report.publish")
        await db.query("UPDATE bi_reports SET status='gelistirme', reject_reason=$1 WHERE id=$2", [reason, Number(q.target_id)]);
      await audit.record("talep.reddedildi", req.user.username, { ok: false, detail: { id, tur: q.kind, gerekce: reason } });
      const key = q.kind.startsWith("ann") ? "ann.reject" : "doc.reject";
      await notify.send(key, { subject: `${q.subject} reddedildi — gerekçe: ${reason}`, requester: q.requested_by, approver: req.user.username }, cfg, req.user.username);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* Talep sahibi düzeltme yapamaz; yalnızca geri çeker ve yeniden girer. */
  r.post("/:id/withdraw", requireScreen("p.my", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const q = await db.one("SELECT * FROM requests WHERE id=$1", [id]);
      if (!q) return res.status(404).json({ error: "Bulunamadı" });
      if (q.requested_by !== req.user.username) return res.status(403).json({ error: "Yalnızca talep sahibi geri çekebilir" });
      if (q.status !== "bekliyor") return res.status(409).json({ error: "Talep zaten sonuçlanmış" });
      await db.query("UPDATE requests SET status='geri_cekildi', decided_at=now() WHERE id=$1", [id]);
      if (q.kind === "ann.publish") await db.query("DELETE FROM announcements WHERE id=$1 AND status='onayda'", [Number(q.target_id)]);
      if (q.kind === "doc.delete") await db.query("UPDATE documents SET pending_delete=FALSE WHERE id=$1", [Number(q.target_id)]);
      if (q.kind === "report.publish") await db.query("UPDATE bi_reports SET status='gelistirme' WHERE id=$1", [Number(q.target_id)]);
      await audit.record("talep.geri_cekildi", req.user.username, { detail: { id, tur: q.kind } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return r;
};
