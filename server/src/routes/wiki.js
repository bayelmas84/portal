"use strict";
const express = require("express");
const { query, withTransaction } = require("../db");
const { requireAuth, requireRead, requireWrite } = require("../middleware/auth");
const { canRead, canWrite } = require("../lib/permissions");
const { sendMail } = require("../lib/mailer");
const { getEmailPrefs } = require("../lib/notify");

const router = express.Router();

const CAN_WRITE_ROLES = ["pmdir", "pm"];

// Issue yorumlarındaki @kullanici.adi tespit mantığının BİREBİR aynısı
// (bkz. projects.js extractMentionedUsernames) — tutarlılık için kopyalandı.
async function extractMentionedUsernames(text) {
  const candidates = [...new Set((String(text || "").match(/@([a-zA-Z0-9_.]+)/g) || []).map((m) => m.slice(1)))];
  if (!candidates.length) return [];
  const { rows } = await query("SELECT username FROM users WHERE username = ANY($1::text[]) AND active", [candidates]);
  return rows.map((r) => r.username);
}

// in_app_notifications'a wiki bağlamlı bir bildirim yazar. project_k/
// issue_key NULL bırakılır (bunlar issue olaylarına özeldir); wiki_page_id
// hangi sayfayla ilgili olduğunu taşır.
async function createWikiNotification(recipientUsername, kind, wikiPageId, title, actorUsername) {
  await query(
    `INSERT INTO in_app_notifications (recipient_username, kind, wiki_page_id, title, actor_username, project_k, issue_key)
     VALUES ($1,$2,$3,$4,$5,NULL,NULL)`,
    [recipientUsername, kind, wikiPageId, title, actorUsername]
  );
}


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

// Sayfa bazlı görünürlük kısıtlaması: space'in genel kuralı geçtikten sonra,
// bu SPESİFİK sayfa için wiki_page_restrictions'ta bir satır varsa, yalnızca
// listelenen roller (+ her zaman pm/pmdir) okuyabilir. Satır yoksa (en yaygın
// durum) davranış değişmez — space kuralı geçerli olmaya devam eder.
async function assertPageReadable(req, res, page) {
  if (!(await assertSpaceReadable(req, res, page))) return false;
  const restr = await query("SELECT allowed_roles FROM wiki_page_restrictions WHERE page_id=$1", [page.id]);
  if (restr.rowCount && restr.rows[0].allowed_roles.length) {
    const allowed = restr.rows[0].allowed_roles;
    if (!allowed.includes(req.user.role) && !CAN_WRITE_ROLES.includes(req.user.role)) {
      res.status(403).json({ error: "Bu sayfayı görüntüleme yetkiniz yok." });
      return false;
    }
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

// Serbest (proje-bağımsız) space oluşturma: Confluence'ta olduğu gibi bir
// space herhangi bir konu için (bir ekip, bir süreç, bir departman...)
// açılabilir — bir projeyle ilişkilendirilmesi ZORUNLU değildir. Bu space'in
// project_k'ı NULL kalır, dolayısıyla Genel space gibi HERKESE açık okumaya
// sahip olur; düzenleme yine yalnızca pm/pmdir'e aittir.
router.post("/spaces", requireAuth, async (req, res, next) => {
  try {
    if (!assertCanWrite(req, res)) return;
    let { spaceKey, name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Alan adı zorunlu." });
    if (!spaceKey || !spaceKey.trim()) {
      // Anahtar verilmemişse isimden türetilir: büyük harf, yalnızca A-Z0-9_,
      // Türkçe karakterler sadeleştirilir (ör. "İK Süreçleri" -> "IK_SURECLERI").
      spaceKey = name.trim().toUpperCase()
        .replace(/İ/g, "I").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ş/g, "S").replace(/Ö/g, "O").replace(/Ç/g, "C")
        .replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
    } else {
      spaceKey = spaceKey.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").slice(0, 40);
    }
    if (!spaceKey) return res.status(400).json({ error: "Geçerli bir alan anahtarı üretilemedi, farklı bir isim deneyin." });
    const { rows } = await query(
      `INSERT INTO wiki_spaces (space_key, name, project_k) VALUES ($1,$2,NULL) RETURNING *`,
      [spaceKey, name.trim().slice(0, 120)]
    );
    res.status(201).json({ item: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Bu anahtarda bir alan zaten var, farklı bir isim deneyin." });
    next(e);
  }
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
    if (!(await assertPageReadable(req, res, rows[0]))) return;
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
    if (!(await assertPageReadable(req, res, page.rows[0]))) return;
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
    if (!(await assertPageReadable(req, res, page.rows[0]))) return;
    const { rows } = await query(
      "SELECT * FROM wiki_page_versions WHERE id=$1 AND page_id=$2",
      [req.params.versionId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Versiyon bulunamadı." });
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

// Eski bir versiyona dönme: o versiyonun içeriği MEVCUT hale kopyalanır,
// mevcut hal (geri yüklemeden hemen önceki) kendisi de bir versiyon olarak
// kaydedilir — yani geri yükleme de geri alınabilir bir işlemdir.
router.put("/pages/:id/restore/:versionId", requireAuth, async (req, res, next) => {
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
    const version = await query(
      "SELECT * FROM wiki_page_versions WHERE id=$1 AND page_id=$2",
      [req.params.versionId, req.params.id]
    );
    if (!version.rowCount) return res.status(404).json({ error: "Versiyon bulunamadı." });
    const v = version.rows[0];
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO wiki_page_versions (page_id, title, content, edited_by) VALUES ($1,$2,$3,$4)`,
        [page.id, page.title, page.content, req.user.username]
      );
      await client.query(
        `UPDATE wiki_pages SET title=$1, content=$2, updated_by=$3, updated_at=now() WHERE id=$4`,
        [v.title, v.content, req.user.username, page.id]
      );
    });
    const { rows } = await query("SELECT * FROM wiki_pages WHERE id=$1", [page.id]);
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

// ------------------------------- Şablonlar ---------------------------------
// Sistem şablonları (created_by=NULL) migration ile hazır gelir, herkes
// kullanabilir. Yeni şablon tanımlamak/silmek yalnızca pm/pmdir'e aittir.
router.get("/templates", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM wiki_page_templates ORDER BY created_by NULLS FIRST, name");
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/templates", requireAuth, async (req, res, next) => {
  try {
    if (!assertCanWrite(req, res)) return;
    const { name, content } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Şablon adı zorunlu." });
    const { rows } = await query(
      `INSERT INTO wiki_page_templates (name, content, created_by) VALUES ($1,$2,$3) RETURNING *`,
      [name.trim().slice(0, 100), content || "", req.user.username]
    );
    res.status(201).json({ item: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Bu isimde bir şablon zaten var." });
    next(e);
  }
});

router.delete("/templates/:id", requireAuth, async (req, res, next) => {
  try {
    if (!assertCanWrite(req, res)) return;
    const { rowCount } = await query(
      "DELETE FROM wiki_page_templates WHERE id=$1 AND created_by IS NOT NULL", [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: "Şablon bulunamadı ya da sistem şablonu silinemez." });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// -------------------------- Sayfa bazlı yetkilendirme -----------------------
// Bir sayfayı space'in genel okuma kuralından daha DAR bir role listesine
// kısıtlar (ör. bir proje space'inde yalnızca yöneticilerin görebileceği
// bütçe notu gibi bir sayfa). Yalnızca sayfayı düzenleyebilen (pm/pmdir)
// kısıtlama tanımlayabilir; pm/pmdir kısıtlamadan HER ZAMAN muaftır.
router.get("/pages/:id/restrictions", requireAuth, async (req, res, next) => {
  try {
    const page = await query(
      `SELECT p.*, s.project_k FROM wiki_pages p JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!page.rowCount) return res.status(404).json({ error: "Sayfa bulunamadı." });
    if (!(await assertPageReadable(req, res, page.rows[0]))) return;
    const { rows } = await query("SELECT allowed_roles FROM wiki_page_restrictions WHERE page_id=$1", [req.params.id]);
    res.json({ allowedRoles: rows[0] ? rows[0].allowed_roles : [] });
  } catch (e) { next(e); }
});

router.put("/pages/:id/restrictions", requireAuth, async (req, res, next) => {
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
    const { allowedRoles } = req.body || {};
    const clean = Array.isArray(allowedRoles) ? allowedRoles.filter((r) => typeof r === "string").slice(0, 20) : [];
    if (clean.length) {
      await query(
        `INSERT INTO wiki_page_restrictions (page_id, allowed_roles, updated_by, updated_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (page_id) DO UPDATE SET allowed_roles=$2, updated_by=$3, updated_at=now()`,
        [req.params.id, clean, req.user.username]
      );
    } else {
      await query("DELETE FROM wiki_page_restrictions WHERE page_id=$1", [req.params.id]);
    }
    res.json({ allowedRoles: clean });
  } catch (e) { next(e); }
});

// ------------------------------- Yorumlar -----------------------------------
// Issue yorumlarıyla AYNI mantık: herkes (sayfayı okuyabiliyorsa) yorum
// yazabilir — düzenleme yetkisi (pm/pmdir) burada aranmaz, çünkü yorum
// yapmak sayfa İÇERİĞİNİ değiştirmez. @kullanici.adi ile etiketlenenlere
// VE sayfa yazarı + daha önce o sayfaya yorum yazmış herkese bildirim gider.
router.get("/pages/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const page = await query(
      `SELECT p.*, s.project_k FROM wiki_pages p JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!page.rowCount) return res.status(404).json({ error: "Sayfa bulunamadı." });
    if (!(await assertPageReadable(req, res, page.rows[0]))) return;
    const { rows } = await query(
      `SELECT c.*, u.name AS author_name FROM wiki_page_comments c
         JOIN users u ON u.username=c.author_username
        WHERE c.page_id=$1 ORDER BY c.created_at`,
      [req.params.id]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/pages/:id/comments", requireAuth, async (req, res, next) => {
  try {
    const page = await query(
      `SELECT p.*, s.project_k FROM wiki_pages p JOIN wiki_spaces s ON s.id=p.space_id WHERE p.id=$1`,
      [req.params.id]
    );
    if (!page.rowCount) return res.status(404).json({ error: "Sayfa bulunamadı." });
    if (!(await assertPageReadable(req, res, page.rows[0]))) return;
    const body = ((req.body && req.body.body) || "").trim();
    if (!body) return res.status(400).json({ error: "Yorum boş olamaz." });
    const { rows } = await query(
      `INSERT INTO wiki_page_comments (page_id, author_username, body) VALUES ($1,$2,$3)
       RETURNING *`,
      [req.params.id, req.user.username, body]
    );
    const author = await query("SELECT name FROM users WHERE username=$1", [req.user.username]);
    const authorName = author.rows[0] ? author.rows[0].name : req.user.username;
    res.status(201).json({ item: { ...rows[0], author_name: authorName } });

    // Bildirimler fire-and-forget: yanıt zaten gönderildi.
    (async () => {
      try {
        const p = page.rows[0];
        const mentioned = await extractMentionedUsernames(body);
        const commenters = await query(
          "SELECT DISTINCT author_username FROM wiki_page_comments WHERE page_id=$1", [req.params.id]
        );
        const participants = new Set(commenters.rows.map((r) => r.author_username));
        if (p.created_by) participants.add(p.created_by);
        participants.delete(req.user.username);
        mentioned.forEach((u) => participants.delete(u));

        const commentSubject = `"${p.title}" wiki sayfasına yeni bir yorum eklendi`;
        const commentText = `${p.title} sayfasına ${authorName} bir yorum yazdı:\n\n"${body}"`;
        const usersToNotify = await query(
          "SELECT username, email FROM users WHERE username = ANY($1::text[]) AND active", [[...participants]]
        );
        for (const u of usersToNotify.rows) {
          const prefs = await getEmailPrefs(u.username);
          if (prefs.comment) await sendMail(u.email, commentSubject, commentText);
          await createWikiNotification(u.username, "wiki_comment", p.id, commentSubject, req.user.username);
        }

        if (mentioned.length) {
          const mentionedUsers = await query(
            "SELECT username, email FROM users WHERE username = ANY($1::text[]) AND active AND username<>$2",
            [mentioned, req.user.username]
          );
          const mentionSubject = `"${p.title}" wiki sayfasında sizden bahsedildi`;
          const mentionText = `${authorName}, "${p.title}" sayfasındaki bir yorumda sizden bahsetti:\n\n"${body}"`;
          for (const u of mentionedUsers.rows) {
            const prefs = await getEmailPrefs(u.username);
            if (prefs.mention) await sendMail(u.email, mentionSubject, mentionText);
            await createWikiNotification(u.username, "wiki_mention", p.id, mentionSubject, req.user.username);
          }
        }
      } catch (mailErr) { /* sessiz geç — bildirim hatası kullanıcıyı etkilemez */ }
    })();
  } catch (e) { next(e); }
});

router.delete("/pages/:id/comments/:commentId", requireAuth, async (req, res, next) => {
  try {
    const comment = await query("SELECT * FROM wiki_page_comments WHERE id=$1 AND page_id=$2", [req.params.commentId, req.params.id]);
    if (!comment.rowCount) return res.status(404).json({ error: "Yorum bulunamadı." });
    const isOwner = comment.rows[0].author_username === req.user.username;
    if (!isOwner && !CAN_WRITE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Yalnızca kendi yorumunuzu (ya da pm/pmdir tüm yorumları) silebilirsiniz." });
    }
    await query("DELETE FROM wiki_page_comments WHERE id=$1", [req.params.commentId]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
