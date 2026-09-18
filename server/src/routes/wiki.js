"use strict";
const express = require("express");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRead, requireWrite } = require("../middleware/auth");
const { canRead, canWrite } = require("../lib/permissions");

const router = express.Router();

const CAN_WRITE_ROLES = ["pmdir", "pm"];

// Bir proje space'ine (project_k dolu) erişim, kullanıcının genel olarak
// "d.board" ekranına (Proje Yönetimi modülü) okuma/yazma yetkisi olup
// olmadığına bakar — ekip üyeliği kontrolü YAPILMAZ, tıpkı diğer proje
// ekranları gibi rol bazlı bir kapıdır. Genel (project_k=NULL) space
// herkese açıktır (requireAuth yeterli).

async function getSpaceOr404(res, spaceKey) {
  const { rows } = await query("SELECT * FROM wiki_spaces WHERE space_key=$1", [spaceKey]);
  if (!rows[0]) { res.status(404).json({ error: "Space bulunamadı." }); return null; }
  return rows[0];
}

async function assertSpaceReadable(req, res, space) {
  if (space.project_k && !(await canRead(req.user.role, "d.board"))) {
    res.status(403).json({ error: "Bu proje alanına erişim yetkiniz yok." });
    return false;
  }
  return true;
}

function assertCanWrite(req, res) {
  if (!CAN_WRITE_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Wiki sayfalarını yalnızca Proje Yöneticisi/Direktörü düzenleyebilir." });
    return false;
  }
  return true;
}

// Kullanıcının görebildiği tüm space'leri döner: Genel her zaman, proje
// space'leri yalnızca kullanıcı d.board okuma yetkisine sahipse.
router.get("/spaces", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM wiki_spaces ORDER BY project_k NULLS FIRST, name");
    const canReadProjects = await canRead(req.user.role, "d.board");
    const visible = rows.filter((s) => !s.project_k || canReadProjects);
    res.json({ items: visible });
  } catch (e) { next(e); }
});

// Bir proje ilk kez wiki'ye girildiğinde, o projenin space'i otomatik
// oluşturulur (kullanıcıyı önden "space oluştur" adımıyla uğraştırmamak
// için) — Genel space migration ile zaten hazır geliyor.
router.post("/spaces/ensure-project/:projectK", requireWrite("d.board"), async (req, res, next) => {
  try {
    const proj = await query("SELECT k, name FROM projects WHERE k=$1", [req.params.projectK]);
    if (!proj.rowCount) return res.status(404).json({ error: "Proje bulunamadı." });
    const { rows } = await query(
      `INSERT INTO wiki_spaces (space_key, name, project_k) VALUES ($1,$2,$1)
       ON CONFLICT (space_key) DO UPDATE SET name=EXCLUDED.name
       RETURNING *`,
      [req.params.projectK, proj.rows[0].name + " Wiki"]
    );
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.get("/spaces/:spaceKey/pages", requireAuth, async (req, res, next) => {
  try {
    const space = await getSpaceOr404(res, req.params.spaceKey);
    if (!space) return;
    if (!(await assertSpaceReadable(req, res, space))) return;
    const { rows } = await query(
      "SELECT id, space_id, parent_id, title, sort_order, updated_by, updated_at FROM wiki_pages WHERE space_id=$1 ORDER BY parent_id NULLS FIRST, sort_order, title",
      [space.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/spaces/:spaceKey/pages", requireAuth, async (req, res, next) => {
  try {
    const space = await getSpaceOr404(res, req.params.spaceKey);
    if (!space) return;
    if (space.project_k && !(await canWrite(req.user.role, "d.board"))) {
      return res.status(403).json({ error: "Bu proje alanına yazma yetkiniz yok." });
    }
    if (!assertCanWrite(req, res)) return;
    const { title, content, parentId } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: "Başlık zorunlu." });
    if (parentId) {
      const parent = await query("SELECT id FROM wiki_pages WHERE id=$1 AND space_id=$2", [parentId, space.id]);
      if (!parent.rowCount) return res.status(400).json({ error: "Üst sayfa bu alanda bulunamadı." });
    }
    const { rows } = await query(
      `INSERT INTO wiki_pages (space_id, parent_id, title, content, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$5) RETURNING *`,
      [space.id, parentId || null, title.trim().slice(0, 200), content || "", req.user.username]
    );
    res.status(201).json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.get("/pages/:id", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.*, s.space_key, s.project_k FROM wiki_pages p
         JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Sayfa bulunamadı." });
    if (!(await assertSpaceReadable(req, res, rows[0]))) return;
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.put("/pages/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT p.*, s.project_k FROM wiki_pages p JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!existing.rowCount) return res.status(404).json({ error: "Sayfa bulunamadı." });
    const page = existing.rows[0];
    if (page.project_k && !(await canWrite(req.user.role, "d.board"))) {
      return res.status(403).json({ error: "Bu proje alanına yazma yetkiniz yok." });
    }
    if (!assertCanWrite(req, res)) return;
    const { title, content } = req.body || {};
    if (title !== undefined && !title.trim()) return res.status(400).json({ error: "Başlık boş olamaz." });
    await withTransaction(async (client) => {
      // Değişmeden önceki hal versiyon geçmişine kaydedilir.
      await client.query(
        `INSERT INTO wiki_page_versions (page_id, title, content, edited_by) VALUES ($1,$2,$3,$4)`,
        [page.id, page.title, page.content, req.user.username]
      );
      await client.query(
        `UPDATE wiki_pages SET title=$1, content=$2, updated_by=$3, updated_at=now() WHERE id=$4`,
        [title !== undefined ? title.trim().slice(0, 200) : page.title, content !== undefined ? content : page.content, req.user.username, page.id]
      );
    });
    const { rows } = await query("SELECT * FROM wiki_pages WHERE id=$1", [page.id]);
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.delete("/pages/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await query(
      `SELECT p.*, s.project_k FROM wiki_pages p JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!existing.rowCount) return res.status(404).json({ error: "Sayfa bulunamadı." });
    const page = existing.rows[0];
    if (page.project_k && !(await canWrite(req.user.role, "d.board"))) {
      return res.status(403).json({ error: "Bu proje alanına yazma yetkiniz yok." });
    }
    if (!assertCanWrite(req, res)) return;
    await query("DELETE FROM wiki_pages WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/pages/:id/versions", requireAuth, async (req, res, next) => {
  try {
    const page = await query(
      `SELECT p.*, s.project_k FROM wiki_pages p JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!page.rowCount) return res.status(404).json({ error: "Sayfa bulunamadı." });
    if (!(await assertSpaceReadable(req, res, page.rows[0]))) return;
    const { rows } = await query(
      "SELECT id, title, edited_by, edited_at FROM wiki_page_versions WHERE page_id=$1 ORDER BY edited_at DESC",
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.get("/pages/:id/versions/:versionId", requireAuth, async (req, res, next) => {
  try {
    const page = await query(
      `SELECT p.*, s.project_k FROM wiki_pages p JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!page.rowCount) return res.status(404).json({ error: "Sayfa bulunamadı." });
    if (!(await assertSpaceReadable(req, res, page.rows[0]))) return;
    const { rows } = await query(
      "SELECT * FROM wiki_page_versions WHERE id=$1 AND page_id=$2",
      [req.params.versionId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Versiyon bulunamadı." });
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
