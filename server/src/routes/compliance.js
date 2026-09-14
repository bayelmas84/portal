"use strict";
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const training = require("../lib/training");
const audit = require("../lib/audit");
const { requireScreen } = require("../middleware/auth");

module.exports = function (cfg) {
  const r = express.Router();

  r.get("/reading", requireScreen("c.read"), async (req, res, next) => {
    try {
      const docNo = req.query.docNo
        ? z.string().regex(/^[A-Z0-9-]{4,32}$/).parse(req.query.docNo)
        : null;
      const docs = await db.many(
        "SELECT DISTINCT doc_no FROM reading_assignments ORDER BY doc_no");
      const target = docNo || (docs[0] && docs[0].doc_no);
      res.json({ docs: docs.map((d) => d.doc_no), docNo: target,
                 items: target ? await training.complianceReport(target) : [] });
    } catch (e) { next(e); }
  });

  r.get("/reminders", requireScreen("c.rem"), async (req, res) => {
    res.json({ items: await training.reminderPlan() });
  });

  /* Hatırlatmalar normalde zamanlanmış görevle çalışır; buradan elle de tetiklenebilir. */
  r.post("/reminders/run", requireScreen("c.rem", "write"), async (req, res, next) => {
    try { res.json(await training.runReminders(cfg, req.user.username)); } catch (e) { next(e); }
  });

  r.get("/audit", requireScreen("c.audit"), async (req, res) => {
    const items = await db.many(
      "SELECT id, at, actor, event, ok, detail FROM audit_log ORDER BY id DESC LIMIT 200");
    res.json({ items, verify: await audit.verify() });
  });

  return r;
};
