"use strict";
/* Faz kapıları (stage gates).
   Kural: bir fazdan sonrakine geçmek için (1) tüm giriş kriterleri karşılanmalı,
   (2) iki farklı kişiden, iki farklı rolden imza gelmelidir.

   İstisna: Proje Yönetim Direktörü ünvanı/rolü tek imzayla kapıyı ilerletebilir.
   Bu bir yetki devri değil, açık bir "override"dır: gerekçe zorunludur, kayıt
   ayrı bir denetim olayı olarak yazılır ve ekranda görünür. Kontrolü gizlemek
   yerine görünür kılmak, hem denetim hem imzalayanın kendi lehinedir. */
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const { requireScreen } = require("../middleware/auth");

/* Tek imzayla ilerletebilecek ünvan ve roller */
const OVERRIDE_TITLES = ["PYD"];
const OVERRIDE_ROLES = ["pmd"];
const canOverride = (u) =>
  OVERRIDE_TITLES.includes(String(u.title_code || "").toUpperCase()) ||
  OVERRIDE_ROLES.includes(u.role_key);

module.exports = function () {
  const r = express.Router();

  const parseCriteria = (v) => (typeof v === "string" ? JSON.parse(v) : (v || []));

  async function gateView(gateId) {
    const g = await db.one("SELECT * FROM stage_gates WHERE id = $1", [gateId]);
    if (!g) return null;
    const signs = await db.many(
      `SELECT s.username, s.role_key, s.signed_at, u.display_name
         FROM stage_gate_signatures s JOIN users u ON u.username = s.username
        WHERE s.gate_id = $1 ORDER BY s.signed_at`, [gateId]);
    const criteria = parseCriteria(g.criteria);
    return {
      id: Number(g.id), projectId: Number(g.project_id), name: g.name,
      criteria, requiredSignatures: g.required_signatures,
      openCriteria: criteria.filter((c) => !c.done).length,
      signatures: signs, passedAt: g.passed_at,
      override: g.override_by ? { by: g.override_by, reason: g.override_reason, at: g.override_at } : null,
    };
  }

  r.get("/project/:projectId", requireScreen("d.gate"), async (req, res, next) => {
    try {
      const pid = z.coerce.number().int().positive().parse(req.params.projectId);
      const rows = await db.many("SELECT id FROM stage_gates WHERE project_id=$1 ORDER BY id", [pid]);
      const items = [];
      for (const g of rows) items.push(await gateView(g.id));
      res.json({ items, canOverride: canOverride(req.user) });
    } catch (e) { next(e); }
  });

  /* Kriter işaretleme: yazma yetkisi olan roller. Her değişiklik kayda geçer. */
  r.put("/:id/criteria/:index", requireScreen("d.gate", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const index = z.coerce.number().int().min(0).max(50).parse(req.params.index);
      const done = z.boolean().parse(req.body.done);
      const g = await db.one("SELECT * FROM stage_gates WHERE id=$1", [id]);
      if (!g) return res.status(404).json({ error: "Bulunamadı" });
      if (g.passed_at) return res.status(409).json({ error: "Geçilmiş kapıda kriter değiştirilemez" });

      const criteria = parseCriteria(g.criteria);
      if (!criteria[index]) return res.status(400).json({ error: "Kriter bulunamadı" });
      criteria[index].done = done;
      criteria[index].markedBy = req.user.username;
      await db.query("UPDATE stage_gates SET criteria = $1 WHERE id = $2", [JSON.stringify(criteria), id]);
      await audit.record("faz_kapisi.kriter", req.user.username, {
        detail: { kapi: g.name, kriter: criteria[index].text, durum: done ? "OK" : "açık" },
      });
      res.json({ item: await gateView(id) });
    } catch (e) { next(e); }
  });

  /* İmza. Varsayılan kural: iki farklı kişi, iki farklı rol.
     Override yetkisi olan kişi tek imzayla ilerletebilir; gerekçe zorunludur. */
  r.post("/:id/sign", requireScreen("d.gate", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const override = z.boolean().default(false).parse(req.body.override === true);
      const reason = override
        ? z.string().trim().min(10).max(2000).parse(req.body.reason)
        : null;

      const g = await db.one("SELECT * FROM stage_gates WHERE id=$1", [id]);
      if (!g) return res.status(404).json({ error: "Bulunamadı" });
      if (g.passed_at) return res.status(409).json({ error: "Kapı zaten geçilmiş" });

      const criteria = parseCriteria(g.criteria);
      const open = criteria.filter((c) => !c.done).length;
      if (open) return res.status(422).json({ error: `${open} giriş kriteri açık; kapı onaylanamaz`, openCriteria: open });

      if (override && !canOverride(req.user))
        return res.status(403).json({ error: "Tek imzayla ilerletme yetkisi Proje Yönetim Direktörü ünvanındadır" });

      const signs = await db.many("SELECT username, role_key FROM stage_gate_signatures WHERE gate_id=$1", [id]);
      if (!override) {
        if (signs.some((s) => s.username === req.user.username))
          return res.status(409).json({ error: "Aynı kişi ikinci imzayı atamaz" });
        if (signs.some((s) => s.role_key === req.user.role_key))
          return res.status(409).json({ error: "İki imza iki farklı rolden olmalıdır" });
      }

      await db.query(
        `INSERT INTO stage_gate_signatures (gate_id, username, role_key) VALUES ($1,$2,$3)
         ON CONFLICT (gate_id, username) DO NOTHING`,
        [id, req.user.username, req.user.role_key]);

      const total = (await db.one("SELECT COUNT(*)::int AS n FROM stage_gate_signatures WHERE gate_id=$1", [id])).n;
      const passed = override || total >= g.required_signatures;
      if (passed) {
        await db.query(
          `UPDATE stage_gates SET passed_at = now(), override_by = $1, override_reason = $2,
                  override_at = CASE WHEN $1 IS NULL THEN NULL ELSE now() END
            WHERE id = $3`,
          [override ? req.user.username : null, reason, id]);
      }
      /* Override ayrı bir olay olarak, gerekçesiyle kayda geçer. */
      await audit.record(override ? "faz_kapisi.tek_imza_override" : "faz_kapisi.imza", req.user.username, {
        ok: !override,
        detail: { kapi: g.name, imza: total, gereken: g.required_signatures,
                  gecildi: passed, gerekce: reason || undefined },
      });
      res.json({ item: await gateView(id), passed, override });
    } catch (e) { next(e); }
  });

  return r;
};
module.exports.canOverride = canOverride;
module.exports.OVERRIDE_TITLES = OVERRIDE_TITLES;
module.exports.OVERRIDE_ROLES = OVERRIDE_ROLES;
