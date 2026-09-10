"use strict";
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const projects = require("../lib/projects");
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
