"use strict";
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const notify = require("../services/notify");
const { requireScreen, isInspection } = require("../middleware/auth");

const CRIT = { Yasal: ["Kritik", "Yüksek"], Genel: ["Yüksek", "Orta", "Düşük"] };

const createSchema = z.object({
  title: z.string().trim().min(5).max(200),
  body: z.string().trim().min(11).max(20000),
  category: z.enum(["Yasal", "Genel"]),
  criticality: z.enum(["Kritik", "Yüksek", "Orta", "Düşük"]),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  popup: z.boolean().default(false),
}).refine((v) => CRIT[v.category].includes(v.criticality), {
  message: "Yasal duyurular yalnızca Kritik veya Yüksek olabilir",
  path: ["criticality"],
});

module.exports = function (cfg) {
  const r = express.Router();

  /* Onaycı: yasal duyuru her zaman Teftiş'e, diğerleri girenin yöneticisine gider. */
  async function approverFor(category, user) {
    if (category === "Yasal") {
      const insp = await db.one("SELECT username FROM users WHERE role_key='inspection' AND active ORDER BY username LIMIT 1");
      if (!insp) throw Object.assign(new Error("Teftiş rolünde aktif kullanıcı tanımlı değil"), { status: 409 });
      return insp.username;
    }
    /* Yöneticisi olmayan kişi (örn. modül direktörü) için onay Teftiş'e düşer:
       hiç kimse kendi duyurusunu onaylamış olmaz. */
    if (!user.manager) {
      const insp = await db.one("SELECT username FROM users WHERE role_key='inspection' AND active ORDER BY username LIMIT 1");
      if (!insp) throw Object.assign(new Error("Teftiş rolünde aktif kullanıcı tanımlı değil"), { status: 409 });
      return insp.username;
    }
    return user.manager;
  }

  /* Liste: yayında olanlar herkese; onay bekleyen yalnızca girene ve Teftiş'e. */
  r.get("/", requireScreen("a.list"), async (req, res) => {
    const rows = await db.many(
      `SELECT a.id, a.title, a.body, a.category, a.criticality, a.valid_until, a.popup, a.status,
              a.created_by, a.created_at, u.display_name AS created_by_name,
              (ar.username IS NOT NULL) AS is_read,
              (dq.id IS NOT NULL) AS has_pending_delete,
              dq.requested_by AS del_requester, dq.approver AS del_approver
         FROM announcements a
         JOIN users u ON u.username = a.created_by
         LEFT JOIN announcement_reads ar ON ar.announcement_id = a.id AND ar.username = $1
         LEFT JOIN requests dq ON dq.target_type = 'announcement' AND dq.target_id = a.id::text
                              AND dq.kind = 'ann.delete' AND dq.status = 'bekliyor'
        WHERE a.status = 'yayinda' OR a.created_by = $1 OR $2 = TRUE
        ORDER BY a.created_at DESC`,
      [req.user.username, isInspection(req)]
    );
    /* Bekleyen silme talebi de bir onay kaydıdır: yalnızca talebi giren, onun yöneticisi,
       onaycı ve Teftiş bilir. Diğerleri için pending_delete her zaman false döner ve
       talebin sahibi/onaycısı istemciye hiç gönderilmez. */
    const subs = await db.many("SELECT username FROM users WHERE manager = $1", [req.user.username]);
    const mine = new Set(subs.map((x) => x.username));
    const insp = isInspection(req);
    const items = rows.map((r) => {
      const party = r.has_pending_delete && (
        r.del_requester === req.user.username || r.del_approver === req.user.username ||
        mine.has(r.del_requester) || insp);
      const { has_pending_delete, del_requester, del_approver, ...rest } = r;
      return { ...rest, pending_delete: !!party };
    });
    res.json({ items });
  });

  r.get("/popup", requireScreen("a.list"), async (req, res) => {
    const row = await db.one(
      `SELECT a.id, a.title, a.body FROM announcements a
         LEFT JOIN announcement_reads x ON x.announcement_id = a.id AND x.username = $1
         LEFT JOIN announcement_popup_dismissed d ON d.announcement_id = a.id AND d.username = $1
        WHERE a.status = 'yayinda' AND a.popup AND a.valid_until >= CURRENT_DATE
          AND x.username IS NULL AND d.username IS NULL
        ORDER BY a.created_at DESC LIMIT 1`,
      [req.user.username]
    );
    res.json({ item: row });
  });

  r.post("/", requireScreen("a.new", "write"), async (req, res, next) => {
    try {
      const v = createSchema.parse(req.body);
      const approver = await approverFor(v.category, req.user);
      const row = await db.one(
        `INSERT INTO announcements (title, body, category, criticality, valid_until, popup, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'onayda',$7) RETURNING id`,
        [v.title, v.body, v.category, v.criticality, v.validUntil, v.popup, req.user.username]
      );
      await db.query(
        `INSERT INTO requests (kind, subject, category, requested_by, approver, reason, target_type, target_id)
         VALUES ('ann.publish',$1,$2,$3,$4,$5,'announcement',$6)`,
        [v.title, v.category, req.user.username, approver,
         v.category === "Yasal" ? "Yasal kategori — Teftiş onayı zorunlu" : "Genel duyuru — yönetici onayı",
         String(row.id)]
      );
      await audit.record("duyuru.onaya_gonderildi", req.user.username, { detail: { id: row.id, kategori: v.category, onaycı: approver } });
      await notify.send("ann.submit", { subject: `Onayınıza düşen duyuru: ${v.title}`, requester: req.user.username, approver }, cfg, req.user.username);
      res.status(201).json({ id: row.id, approver });
    } catch (e) { next(e); }
  });

  /* Yayınlanmış duyuruyu yalnızca Teftiş düzenler; onay bekleyeni yalnızca sahibi düzenler. */
  r.put("/:id", requireScreen("a.list", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const a = await db.one("SELECT * FROM announcements WHERE id=$1", [id]);
      if (!a) return res.status(404).json({ error: "Bulunamadı" });
      if (a.status === "yayinda" && !isInspection(req))
        return res.status(403).json({ error: "Yayınlanmış duyuruyu yalnızca Teftiş değiştirebilir" });
      if (a.status !== "yayinda" && a.created_by !== req.user.username)
        return res.status(403).json({ error: "Onay bekleyen duyuruyu yalnızca girişi yapan değiştirebilir" });
      const v = createSchema.parse(req.body);
      await db.query(
        `UPDATE announcements SET title=$1, body=$2, category=$3, criticality=$4, valid_until=$5, popup=$6 WHERE id=$7`,
        [v.title, v.body, v.category, v.criticality, v.validUntil, v.popup, id]
      );
      if (a.status !== "yayinda")
        await db.query(`UPDATE requests SET subject=$1, category=$2, created_at=now() WHERE target_type='announcement' AND target_id=$3 AND status='bekliyor'`,
          [v.title, v.category, String(id)]);
      await audit.record("duyuru.guncellendi", req.user.username, { detail: { id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* Silme doğrudan yapılmaz: gerekçeli talep açılır. */
  r.post("/:id/delete-request", requireScreen("a.del", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const reason = z.string().trim().min(10).max(2000).parse(req.body.reason);
      const a = await db.one("SELECT * FROM announcements WHERE id=$1 AND status='yayinda'", [id]);
      if (!a) return res.status(404).json({ error: "Bulunamadı" });
      /* Talebi duyuruyu giren kişi açar; Teftiş de kaldırma talebi açabilir.
         Admin veya başka bir yetkili, sahibi olmadığı duyuru için talep açamaz. */
      if (a.created_by !== req.user.username && !isInspection(req))
        return res.status(403).json({ error: "Silme talebini duyuruyu giren kişi veya Teftiş açabilir" });
      const open = await db.one(
        "SELECT 1 FROM requests WHERE target_type='announcement' AND target_id=$1 AND status='bekliyor'", [String(id)]);
      if (open) return res.status(409).json({ error: "Bu duyuru için bekleyen bir talep var" });
      const approver = await approverFor(a.category, req.user);
      await db.query(
        `INSERT INTO requests (kind, subject, category, requested_by, approver, reason, target_type, target_id)
         VALUES ('ann.delete',$1,$2,$3,$4,$5,'announcement',$6)`,
        [a.title, a.category, req.user.username, approver, reason, String(id)]
      );
      await audit.record("duyuru.silme_talebi", req.user.username, { detail: { id, onaycı: approver } });
      await notify.send("ann.delreq", { subject: `Duyuru silme talebi onayda: ${a.title}`, requester: req.user.username, approver }, cfg, req.user.username);
      res.status(201).json({ ok: true, approver });
    } catch (e) { next(e); }
  });

  r.post("/:id/read", requireScreen("a.list"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const a = await db.one("SELECT id FROM announcements WHERE id=$1 AND status='yayinda'", [id]);
      if (!a) return res.status(404).json({ error: "Bulunamadı" });
      await db.query(
        `INSERT INTO announcement_reads (announcement_id, username) VALUES ($1,$2)
         ON CONFLICT (announcement_id, username) DO NOTHING`, [id, req.user.username]);
      await audit.record("duyuru.okundu", req.user.username, { detail: { id } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.post("/:id/dismiss-popup", requireScreen("a.list"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      await db.query(
        `INSERT INTO announcement_popup_dismissed (announcement_id, username) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`, [id, req.user.username]);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return r;
};
