"use strict";
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const training = require("../lib/training");
const { requireScreen } = require("../middleware/auth");

module.exports = function (cfg) {
  const r = express.Router();

  r.get("/pending", requireScreen("t.un"), async (req, res) => {
    res.json({ items: await training.pendingOf(req.user.username), secondsPerPage: cfg.READING_SECONDS_PER_PAGE });
  });

  r.get("/completed", requireScreen("t.done"), async (req, res) => {
    res.json({ items: await training.completedOf(req.user.username) });
  });

  /* Sınav yalnızca okuma onayı verildikten sonra açılır. */
  r.get("/:docNo/quiz", requireScreen("t.un"), async (req, res, next) => {
    try {
      const docNo = z.string().regex(/^[A-Z0-9-]{4,32}$/).parse(req.params.docNo);
      const doc = await db.one("SELECT doc_no, version FROM documents WHERE doc_no=$1 AND status='yayinda'", [docNo]);
      if (!doc) return res.status(404).json({ error: "Bulunamadı" });
      const ack = await db.one(
        "SELECT 1 FROM document_acks WHERE doc_no=$1 AND version=$2 AND username=$3",
        [doc.doc_no, doc.version, req.user.username]);
      if (!ack) return res.status(422).json({ error: "Önce dokümanı okuyup onaylamanız gerekiyor" });
      res.json({ questions: await training.questionsFor(docNo), passScore: cfg.QUIZ_PASS_SCORE });
    } catch (e) { next(e); }
  });

  r.post("/:docNo/quiz", requireScreen("t.un", "write"), async (req, res, next) => {
    try {
      const docNo = z.string().regex(/^[A-Z0-9-]{4,32}$/).parse(req.params.docNo);
      const answers = z.record(z.coerce.number().int().min(0).max(10)).parse(req.body.answers || {});
      const doc = await db.one("SELECT doc_no, version FROM documents WHERE doc_no=$1 AND status='yayinda'", [docNo]);
      if (!doc) return res.status(404).json({ error: "Bulunamadı" });
      const ack = await db.one(
        "SELECT 1 FROM document_acks WHERE doc_no=$1 AND version=$2 AND username=$3",
        [doc.doc_no, doc.version, req.user.username]);
      if (!ack) return res.status(422).json({ error: "Önce dokümanı okuyup onaylamanız gerekiyor" });
      const result = await training.grade(docNo, req.user.username, answers, cfg.QUIZ_PASS_SCORE, cfg);
      res.json(result);
    } catch (e) { next(e); }
  });

  return r;
};
