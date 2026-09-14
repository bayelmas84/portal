"use strict";
// Genel arama: duyuru, eğitim/doküman ve proje başlıklarında tek noktadan arama.
// Sadece kullanıcının zaten erişimi olan (aktif/yayında/silinmemiş) kayıtları tarar;
// ekran bazlı yetki kontrolü burada tekrarlanmaz çünkü sonuçlar yalnızca başlık/özet
// gösterir, tıklanınca ilgili ekranın kendi yetki kontrolüne düşer.
const express = require("express");
const { query } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ items: [] });
    const like = `%${q}%`;

    const [ann, docs, projects] = await Promise.all([
      query(
        `SELECT id, title AS label, 'announcement' AS kind, category AS meta
         FROM announcements WHERE status='yayinda' AND title ILIKE $1
         ORDER BY created_at DESC LIMIT 8`,
        [like]
      ),
      query(
        `SELECT id, (doc_no || ' — ' || title) AS label, 'document' AS kind, category AS meta
         FROM policy_documents WHERE status='yayinda' AND (title ILIKE $1 OR doc_no ILIKE $1)
         ORDER BY created_at DESC LIMIT 8`,
        [like]
      ),
      query(
        `SELECT k AS id, (k || ' — ' || name) AS label, 'project' AS kind, method AS meta
         FROM projects WHERE name ILIKE $1 OR k ILIKE $1
         ORDER BY name LIMIT 8`,
        [like]
      ),
    ]);

    res.json({
      items: [
        ...ann.rows.map((r) => ({ ...r, group: "Duyurular" })),
        ...docs.rows.map((r) => ({ ...r, group: "Eğitim/Doküman" })),
        ...projects.rows.map((r) => ({ ...r, group: "Projeler" })),
      ],
    });
  } catch (e) { next(e); }
});

module.exports = router;
