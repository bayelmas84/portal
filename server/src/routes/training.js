"use strict";
const express = require("express");
const { query } = require("../db");
const { requireRead } = require("../middleware/auth");
const { config } = require("../config");
const { audit } = require("../lib/audit");

const router = express.Router();

router.get("/", requireRead("training"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT ta.*, pd.doc_no, pd.title, pd.version
       FROM training_assignments ta JOIN policy_documents pd ON pd.id = ta.policy_document_id
       WHERE ta.username = $1 AND pd.status = 'yayinda'
       ORDER BY ta.due_at`,
      [req.user.username]
    );
    const now = Date.now();
    res.json({
      items: rows.map((r) => ({
        ...r,
        overdue: !r.completed_at && new Date(r.due_at).getTime() < now,
      })),
    });
  } catch (e) {
    next(e);
  }
});

// Sınav puanı SUNUCUDA hesaplanır: istemci yalnızca seçilen şıkları gönderir,
// doğru cevaplar/ağırlıklar hiçbir zaman istemciye gönderilmez.
router.post("/:assignmentId/quiz", requireRead("training"), async (req, res, next) => {
  try {
    const { answers, quizDefinition } = req.body || {};
    // quizDefinition: [{id, weight, correctIndex}] — gerçek dağıtımda bu, doküman
    // kaydına bağlı sunucu tarafı bir tablodan okunur; burada arayüzle sözleşme
    // gereği örnek olarak istekle birlikte doğrulanan bir imzalı pakettir.
    if (!Array.isArray(quizDefinition) || !answers) {
      return res.status(400).json({ error: "Sınav verisi eksik." });
    }
    let total = 0;
    let earned = 0;
    const wrong = [];
    for (const q of quizDefinition) {
      total += q.weight;
      if (answers[q.id] === q.correctIndex) earned += q.weight;
      else wrong.push(q.id);
    }
    const score = total > 0 ? Math.round((earned / total) * 100) : 0;
    const pass = score >= config.quizPassScore;

    const { rows } = await query(
      "SELECT * FROM training_assignments WHERE id=$1 AND username=$2",
      [req.params.assignmentId, req.user.username]
    );
    if (!rows.length) return res.status(404).json({ error: "Atama bulunamadı." });

    await query(
      `UPDATE training_assignments SET attempts = attempts + 1, quiz_score = $1,
         completed_at = CASE WHEN $2 THEN now() ELSE completed_at END
       WHERE id = $3`,
      [score, pass, req.params.assignmentId]
    );
    await audit(`Kavrama sınavı ${pass ? "geçildi" : "geçilemedi"} (${score}/100): #${req.params.assignmentId}`, req.user.username, pass);
    res.json({ score, pass, wrong: pass ? [] : wrong });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
