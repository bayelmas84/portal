"use strict";
const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Kayıtlı filtreler herkese açıktır (herhangi bir ekran yetkisine bağlı
// değildir) — yalnızca oturum açmış olmak yeterlidir. Her kullanıcı
// sadece KENDİ filtrelerini görür/yönetir (username ile sınırlı).
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT id, name, project_k, filters_json, created_at FROM saved_filters WHERE username=$1 ORDER BY created_at DESC",
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { name, projectK, filters } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Filtre adı zorunlu." });
    if (name.trim().length > 60) return res.status(400).json({ error: "Filtre adı en fazla 60 karakter olabilir." });
    const { rows } = await query(
      `INSERT INTO saved_filters (username, name, project_k, filters_json)
       VALUES ($1, $2, $3, $4) RETURNING id, name, project_k, filters_json, created_at`,
      [req.user.username, name.trim(), projectK || null, JSON.stringify(filters || {})]
    );
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { rowCount } = await query(
      "DELETE FROM saved_filters WHERE id=$1 AND username=$2",
      [req.params.id, req.user.username]
    );
    if (!rowCount) return res.status(404).json({ error: "Filtre bulunamadı." });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
