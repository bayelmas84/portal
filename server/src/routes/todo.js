"use strict";
const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const VALID_STATUS = ["open", "waiting", "prog", "done", "cancel"];

// Kişisel to-do listesi herkese açıktır (herhangi bir ekran yetkisine bağlı
// değildir) — yalnızca oturum açmış olmak yeterlidir. Her kullanıcı sadece
// KENDİ kalemlerini görür/yönetir (username ile sınırlı).
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const archived = req.query.archived === "true";
    const { rows } = await query(
      "SELECT * FROM todo_items WHERE username=$1 AND archived=$2 ORDER BY (due_date IS NULL), due_date, id DESC",
      [req.user.username, archived]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { category, description, dueDate } = req.body || {};
    if (!description || !description.trim()) return res.status(400).json({ error: "Açıklama zorunlu." });
    if (description.trim().length > 500) return res.status(400).json({ error: "Açıklama en fazla 500 karakter olabilir." });
    const cat = (category || "Genel").trim().slice(0, 40) || "Genel";
    const { rows } = await query(
      `INSERT INTO todo_items (username, category, description, due_date)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.user.username, cat, description.trim(), dueDate || null]
    );
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.put("/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await query("SELECT * FROM todo_items WHERE id=$1 AND username=$2", [req.params.id, req.user.username]);
    if (!existing.rowCount) return res.status(404).json({ error: "Kalem bulunamadı." });
    const item = existing.rows[0];

    const { category, description, dueDate, status, completionDate } = req.body || {};
    const fields = [], values = [];
    let i = 1;
    if (category !== undefined) { fields.push(`category=$${i++}`); values.push((category || "Genel").trim().slice(0, 40) || "Genel"); }
    if (description !== undefined) {
      if (!description.trim()) return res.status(400).json({ error: "Açıklama zorunlu." });
      fields.push(`description=$${i++}`); values.push(description.trim().slice(0, 500));
    }
    if (dueDate !== undefined) { fields.push(`due_date=$${i++}`); values.push(dueDate || null); }
    if (status !== undefined) {
      if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: "Geçersiz durum." });
      fields.push(`status=$${i++}`); values.push(status);
      // Done dışına çıkılırsa tamamlanma tarihi ve arşiv durumu sıfırlanır.
      if (status !== "done") { fields.push(`completion_date=NULL`); fields.push(`archived=false`); }
    }
    if (completionDate !== undefined) {
      fields.push(`completion_date=$${i++}`); values.push(completionDate || null);
      // Tamamlanma tarihi girilince (ve durum done ise) arşive gönderilir.
      const nextStatus = status !== undefined ? status : item.status;
      if (completionDate && nextStatus === "done") fields.push(`archived=true`);
      else if (!completionDate) fields.push(`archived=false`);
    }
    if (!fields.length) return res.status(400).json({ error: "Güncellenecek alan yok." });
    fields.push(`updated_at=now()`);
    values.push(req.params.id, req.user.username);
    const { rows } = await query(
      `UPDATE todo_items SET ${fields.join(",")} WHERE id=$${i++} AND username=$${i++} RETURNING *`,
      values
    );
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM todo_items WHERE id=$1 AND username=$2",
      [req.params.id, req.user.username]
    );
    if (!rowCount) return res.status(404).json({ error: "Kalem bulunamadı." });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
