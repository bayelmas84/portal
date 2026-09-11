"use strict";
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const projects = require("../lib/projects");
const access = require("../services/access");
const { requireScreen } = require("../middleware/auth");

module.exports = function (cfg) {
  const r = express.Router();

  r.get("/", requireScreen("d.projects"), async (req, res) => {
    const list = await db.many("SELECT id FROM projects ORDER BY code");
    const items = [];
    for (const p of list) items.push(await projects.projectMetrics(p.id));
    res.json({ items });
  });

  r.get("/mine", requireScreen("d.my"), async (req, res) => {
    const items = await db.many(
      `SELECT i.id, i.item_key, i.type, i.title, i.state, i.priority, i.points,
              p.code AS project_code, p.name AS project_name, p.id AS project_id
         FROM project_items i JOIN projects p ON p.id = i.project_id
        WHERE i.assignee = $1 AND i.state <> 'done'
        ORDER BY p.code, i.item_key`, [req.user.username]);
    res.json({ items });
  });

  r.get("/:id", requireScreen("d.projects"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const metrics = await projects.projectMetrics(id);
      if (!metrics || !metrics.code) return res.status(404).json({ error: "Bulunamadı" });
      const items = await db.many(
        `SELECT id, item_key, type, title, state, priority, points, assignee, sprint_id
           FROM project_items WHERE project_id = $1 ORDER BY item_key`, [id]);
      res.json({ metrics, items, distribution: await projects.distribution(id) });
    } catch (e) { next(e); }
  });

  /* Jira'daki grafiklerin verisi: burndown, hız, durum ve kişi dağılımı */
  r.get("/:id/charts", requireScreen("d.projects"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      res.json({
        burndown: await projects.burndown(id),
        velocity: await projects.velocity(id),
        distribution: await projects.distribution(id),
        metrics: await projects.projectMetrics(id),
      });
    } catch (e) { next(e); }
  });

  /* İş kaleminin durumunu değiştirme (board sürükleme karşılığı) */
  r.put("/items/:key/state", requireScreen("d.board", "write"), async (req, res, next) => {
    try {
      const key = z.string().regex(/^[A-Z]{2,10}-\d{1,6}$/).parse(req.params.key);
      const state = z.enum(["backlog", "todo", "prog", "review", "test", "done"]).parse(req.body.state);
      const it = await db.one("SELECT * FROM project_items WHERE item_key = $1", [key]);
      if (!it) return res.status(404).json({ error: "Bulunamadı" });
      await db.query(
        `UPDATE project_items SET state = $1, closed_at = CASE WHEN $1 = 'done' THEN now() ELSE NULL END
          WHERE item_key = $2`, [state, key]);
      await audit.record("is.durum_degisti", req.user.username, { detail: { kayit: key, durum: state } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* --- Faz kapıları (stage gates) ---
     Onay kuralı iki yoldan biriyle sağlanır:
       1) İki farklı kişiden, iki farklı rolden imza (varsayılan görevler ayrılığı kuralı), ya da
       2) Faz kapısı onay yetkisi olan ünvanın (Proje Yönetim Direktörü) tek imzası.
     İkinci yol kullanıldığında kayıt "tek yetkili onayı" olarak işaretlenir ve denetim kaydına
     ayrı bir olay olarak yazılır; Teftiş bu geçişleri ayırt edebilir. */
  r.get("/:id/gates", requireScreen("d.gate"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const gates = await db.many(
        `SELECT id, name, criteria, required_signatures, passed_at, passed_by, passed_rule
           FROM stage_gates WHERE project_id = $1 ORDER BY id`, [id]);
      for (const g of gates) {
        g.criteria = typeof g.criteria === "string" ? JSON.parse(g.criteria) : (g.criteria || []);
        g.signatures = await db.many(
          `SELECT s.username, s.role_key, s.authority, s.signed_at, u.display_name
             FROM stage_gate_signatures s JOIN users u ON u.username = s.username
            WHERE s.gate_id = $1 ORDER BY s.signed_at`, [g.id]);
        g.openCriteria = g.criteria.filter((c) => !c.done).length;
      }
      res.json({ items: gates, canApprove: projects.isGateAuthority(req.user) || access.canWrite(req.access, "d.gate.approve") });
    } catch (e) { next(e); }
  });

  r.put("/gates/:gateId/criteria/:index", requireScreen("d.gate", "write"), async (req, res, next) => {
    try {
      const gateId = z.coerce.number().int().positive().parse(req.params.gateId);
      const index = z.coerce.number().int().min(0).max(50).parse(req.params.index);
      const done = z.boolean().parse(req.body.done);
      const g = await db.one("SELECT * FROM stage_gates WHERE id=$1", [gateId]);
      if (!g) return res.status(404).json({ error: "Bulunamadı" });
      if (g.passed_at) return res.status(409).json({ error: "Geçilmiş kapının kriterleri değiştirilemez" });
      const crit = typeof g.criteria === "string" ? JSON.parse(g.criteria) : (g.criteria || []);
      if (!crit[index]) return res.status(400).json({ error: "Kriter bulunamadı" });
      crit[index].done = done;
      crit[index].changedBy = req.user.username;
      await db.query("UPDATE stage_gates SET criteria = $1 WHERE id = $2", [JSON.stringify(crit), gateId]);
      await audit.record("kapi.kriter_degisti", req.user.username,
        { detail: { kapi: g.name, kriter: crit[index].text, durum: done ? "OK" : "açık" } });
      res.json({ ok: true, criteria: crit });
    } catch (e) { next(e); }
  });

  r.post("/gates/:gateId/sign", requireScreen("d.gate", "write"), async (req, res, next) => {
    try {
      const gateId = z.coerce.number().int().positive().parse(req.params.gateId);
      const g = await db.one("SELECT * FROM stage_gates WHERE id=$1", [gateId]);
      if (!g) return res.status(404).json({ error: "Bulunamadı" });
      if (g.passed_at) return res.status(409).json({ error: "Kapı zaten geçildi" });

      const crit = typeof g.criteria === "string" ? JSON.parse(g.criteria) : (g.criteria || []);
      const open = crit.filter((c) => !c.done);
      if (open.length)
        return res.status(422).json({ error: "Açık giriş kriteri varken kapı onaylanamaz", openCriteria: open.map((c) => c.text) });

      const authority = projects.isGateAuthority(req.user);
      const signs = await db.many("SELECT username, role_key, authority FROM stage_gate_signatures WHERE gate_id=$1", [gateId]);

      if (!authority) {
        /* Varsayılan kural: aynı kişi ikinci imzayı atamaz, iki imza iki farklı rolden olmalı. */
        if (signs.some((s) => s.username === req.user.username))
          return res.status(409).json({ error: "Aynı kişi ikinci imzayı atamaz" });
        if (signs.some((s) => s.role_key === req.user.role_key))
          return res.status(409).json({ error: "İki imza iki farklı rolden olmalı" });
      }

      await db.query(
        `INSERT INTO stage_gate_signatures (gate_id, username, role_key, authority) VALUES ($1,$2,$3,$4)
         ON CONFLICT (gate_id, username) DO UPDATE SET authority = EXCLUDED.authority, signed_at = now()`,
        [gateId, req.user.username, req.user.role_key, authority]);

      const all = await db.many("SELECT username, authority FROM stage_gate_signatures WHERE gate_id=$1", [gateId]);
      const passed = authority || all.length >= (g.required_signatures || 2);
      if (passed) {
        const rule = authority ? "yetkili_tek_imza" : "iki_imza";
        await db.query("UPDATE stage_gates SET passed_at = now(), passed_by = $1, passed_rule = $2 WHERE id = $3",
          [req.user.username, rule, gateId]);
        /* Tek yetkili onayı ayrı olay olarak yazılır; denetimde ayırt edilebilir. */
        await audit.record(authority ? "kapi.gecildi_yetkili_onayi" : "kapi.gecildi_iki_imza", req.user.username,
          { detail: { kapi: g.name, unvan: req.user.title_code, imza: all.length } });
      } else {
        await audit.record("kapi.imzalandi", req.user.username, { detail: { kapi: g.name, imza: all.length } });
      }
      res.json({ ok: true, passed, signatures: all.length, rule: passed ? (authority ? "yetkili_tek_imza" : "iki_imza") : null });
    } catch (e) { next(e); }
  });

  /* --- proje ekleme ve silme (tam yetki gerektirir) --- */
  const projSchema = z.object({
    code: z.string().trim().regex(/^[A-Z]{2,10}$/, "Proje kodu 2-10 büyük harf olmalı"),
    name: z.string().trim().min(5).max(160),
    method: z.enum(["Scrum", "Kanban", "Waterfall"]),
    lead: z.string().trim().regex(/^[a-z0-9._-]{2,64}$/),
    unitCode: z.string().trim().max(16).nullable().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });

  r.post("/", requireScreen("d.projects", "write"), async (req, res, next) => {
    try {
      const v = projSchema.parse(req.body);
      const lead = await db.one("SELECT username FROM users WHERE username=$1 AND active", [v.lead]);
      if (!lead) return res.status(400).json({ error: "Proje sorumlusu tanımlı ve aktif olmalı" });
      const row = await db.one(
        `INSERT INTO projects (code, name, method, lead, unit_code, start_date, target_date, status, health)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'devam','planinda') RETURNING id`,
        [v.code, v.name, v.method, v.lead, v.unitCode || null, v.startDate || null, v.targetDate || null]);
      await audit.record("proje.olusturuldu", req.user.username, { detail: { kod: v.code, yontem: v.method } });
      /* Internal Audit ve Risk otomatik olarak zorunlu üye eklenir (CHANGELOG 1.13.1). */
      await projects.ensureMandatoryMembers(row.id);
      res.status(201).json({ id: row.id });
    } catch (e) { next(e); }
  });

  /* --- Proje ekibi ---
     Internal Audit ve Risk zorunlu üyedir, çıkarılamaz. Diğer yedi rolden (Project Manager,
     Developer, QA, Business Owner, Product Owner, Vendor, Analyst) istenildiği kadar eklenebilir.
     GET her zaman mevcut projelerde eksik zorunlu üyeliği tamamlar (lazy backfill); böylece
     10_project_team.sql'den önce oluşturulmuş projeler de otomatik tamamlanır. */
  const memberSchema = z.object({
    username: z.string().trim().regex(/^[a-z0-9._-]{2,64}$/),
    projectRole: z.enum([
      "Project Manager", "Developer", "QA", "Business Owner", "Product Owner",
      "Internal Audit", "Risk", "Vendor", "Analyst",
    ]),
  });

  r.get("/:id/team", requireScreen("d.team"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const p = await db.one("SELECT id FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });
      await projects.ensureMandatoryMembers(id);
      res.json({ items: await projects.teamOf(id) });
    } catch (e) { next(e); }
  });

  r.post("/:id/team", requireScreen("d.team", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const v = memberSchema.parse(req.body);
      if (v.projectRole === "Internal Audit" || v.projectRole === "Risk")
        return res.status(400).json({
          error: "Internal Audit ve Risk üyeliği otomatik atanır, elle eklenemez",
        });
      const p = await db.one("SELECT id FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });
      const u = await db.one("SELECT username FROM users WHERE username=$1 AND active", [v.username]);
      if (!u) return res.status(400).json({ error: "Kullanıcı tanımlı ve aktif olmalı" });
      const existing = await db.one("SELECT username FROM project_members WHERE project_id=$1 AND username=$2", [id, v.username]);
      if (existing) return res.status(409).json({ error: "Kullanıcı zaten bu projenin ekibinde" });
      await db.query(
        `INSERT INTO project_members (project_id, username, project_role, is_mandatory, added_by)
         VALUES ($1,$2,$3,FALSE,$4)`,
        [id, v.username, v.projectRole, req.user.username]);
      await audit.record("ekip.uye_eklendi", req.user.username,
        { detail: { proje: id, kullanici: v.username, rol: v.projectRole } });
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  r.delete("/:id/team/:username", requireScreen("d.team", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const username = z.string().trim().regex(/^[a-z0-9._-]{2,64}$/).parse(req.params.username);
      const m = await db.one("SELECT is_mandatory, project_role FROM project_members WHERE project_id=$1 AND username=$2", [id, username]);
      if (!m) return res.status(404).json({ error: "Bulunamadı" });
      if (m.is_mandatory)
        return res.status(409).json({ error: `${m.project_role} zorunlu ekip üyesidir, çıkarılamaz` });
      await db.query("DELETE FROM project_members WHERE project_id=$1 AND username=$2", [id, username]);
      await audit.record("ekip.uye_cikarildi", req.user.username, { detail: { proje: id, kullanici: username } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.delete("/:id", requireScreen("d.projects", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      /* Silme ayrı bir yetkidir: proje yöneticisi ekler ve değiştirir, silmeyi direktör yapar. */
      if (!access.canWrite(req.access, "d.delete"))
        return res.status(403).json({ error: "Proje silme yetkisi yalnızca Proje Yönetim Direktörü'ndedir" });
      const p = await db.one("SELECT code, name FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
      await audit.record("proje.silindi", req.user.username, { ok: false, detail: { kod: p.code, ad: p.name } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* --- Yönetici özet raporu: ünvan bazlı kısıt --- */
  r.get("/reports/executive", requireScreen("d.exec"), async (req, res) => {
    if (!projects.isExec(req.user))
      return res.status(403).json({
        error: "Yönetici özet raporu Direktör, Grup Direktörü ve Genel Müdür Yardımcısı ünvanlarına açıktır",
      });
    const summary = await projects.executiveSummary();
    await audit.record("yonetici_ozeti.goruntulendi", req.user.username,
      { detail: { unvan: req.user.title_code, proje: summary.totals.projects } });
    res.json(summary);
  });

  return r;
};
