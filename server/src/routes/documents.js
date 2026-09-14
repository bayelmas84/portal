"use strict";
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const notify = require("../services/notify");
const { requireScreen, isInspection } = require("../middleware/auth");

const PDF_MAGIC = Buffer.from("%PDF-");
/* Sunucunun ürettiği depolama adı kalıbı: DOKNO_zamandamgasi_rastgele.pdf */
const STORED_NAME = /^[A-Z0-9-]{1,32}_\d{10,16}_[a-f0-9]{12}\.pdf$/;

/* Dosya adı sunucuda üretilir; istemciden gelen ad yalnızca gösterim için saklanır (yol ayracı temizlenir). */
const safeName = (n) => String(n || "dosya.pdf").replace(/[\\/\u0000-\u001f]/g, "_").slice(-120);

module.exports = function (cfg) {
  const r = express.Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: cfg.UPLOAD_MAX_MB * 1024 * 1024, files: 1 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype !== "application/pdf") return cb(Object.assign(new Error("Yalnızca PDF kabul edilir"), { status: 400 }));
      cb(null, true);
    },
  });

  async function inspector() {
    const insp = await db.one("SELECT username FROM users WHERE role_key='inspection' AND active ORDER BY username LIMIT 1");
    if (!insp) throw Object.assign(new Error("Teftiş rolünde aktif kullanıcı yok"), { status: 409 });
    return insp.username;
  }

  /* Onay bekleyen doküman yalnızca üç tarafa görünür: yükleyen, yükleyenin yöneticisi, Teftiş.
     Yayına giren doküman herkese açıktır. */
  r.get("/", requireScreen("k.docs"), async (req, res) => {
    const rows = await db.many(
      `SELECT d.id, d.doc_no, d.title, d.version, d.category, d.status, d.uploaded_by, d.file_name,
              d.page_count, d.effective_date, d.reject_reason, d.pending_delete,
              (a.username IS NOT NULL) AS acked
         FROM documents d
         JOIN users up ON up.username = d.uploaded_by
         LEFT JOIN document_acks a ON a.doc_no = d.doc_no AND a.version = d.version AND a.username = $1
        WHERE d.status = 'yayinda'
           OR d.uploaded_by = $1
           OR up.manager = $1
           OR $2 = TRUE
        ORDER BY d.doc_no, d.version DESC`,
      [req.user.username, isInspection(req)]
    );
    res.json({ items: rows });
  });

  /* Kuyruk yalnızca Teftiş rolüne açıktır; ekran yetkisi tek başına yeterli değildir. */
  r.get("/queue", requireScreen("k.queue"), async (req, res) => {
    if (!isInspection(req)) return res.status(404).json({ error: "Bulunamadı" });
    const rows = await db.many(
      `SELECT id, doc_no, title, version, category, uploaded_by, file_name, reject_reason
         FROM documents WHERE status <> 'yayinda' ORDER BY created_at ASC`);
    res.json({ items: rows });
  });

  async function readable(req, id) {
    const d = await db.one("SELECT * FROM documents WHERE id=$1", [id]);
    if (!d) return { code: 404 };
    if (d.status === "yayinda") return { doc: d };
    /* Onay bekleyen kayıt: yükleyen, yükleyenin yöneticisi ve Teftiş dışında kimseye —
       varlığı bile sızdırılmadan — 404 döner. */
    const up = await db.one("SELECT manager FROM users WHERE username = $1", [d.uploaded_by]);
    const isOwner = d.uploaded_by === req.user.username;
    const isManager = !!up && up.manager === req.user.username;
    if (!isOwner && !isManager && !isInspection(req)) return { code: 404 };
    return { doc: d };
  }

  r.get("/:id", requireScreen("k.docs"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { doc, code } = await readable(req, id);
      if (code) return res.status(code).json({ error: "Bulunamadı" });
      res.json({ item: doc });
    } catch (e) { next(e); }
  });

  /* Dosya içeriği: yalnızca yetkili kişi, yalnızca kayıtlı yoldan; yol dışarıdan gelmez. */
  r.get("/:id/file", requireScreen("k.docs"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { doc, code } = await readable(req, id);
      if (code) return res.status(code).json({ error: "Bulunamadı" });
      /* Depolanan ad sunucunun ürettiği kalıba uymak zorundadır; uymuyorsa dosya açılmaz. */
      if (!STORED_NAME.test(doc.file_path)) return res.status(400).json({ error: "Geçersiz dosya kaydı" });
      const abs = path.resolve(cfg.UPLOAD_DIR, path.basename(doc.file_path));
      if (!abs.startsWith(path.resolve(cfg.UPLOAD_DIR) + path.sep)) return res.status(400).json({ error: "Geçersiz yol" });
      /* Başlıktaki dosya adı kayıt alanlarından yeniden üretilir; yüklenen adın kendisi
         hiçbir zaman yanıt başlığına geçmez (header manipulation). */
      const safe = `${String(doc.doc_no).replace(/[^A-Z0-9-]/gi, "")}_v${String(doc.version).replace(/[^0-9.]/g, "")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      /* PDF içindeki betik ve dış istekler engellenir; dosya kum havuzunda açılır. */
      res.setHeader("Content-Security-Policy", "default-src 'none'; object-src 'none'; sandbox");
      res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.sendFile(abs);
    } catch (e) { next(e); }
  });

  r.post("/", requireScreen("k.new", "write"), upload.single("file"), async (req, res, next) => {
    try {
      const v = z.object({
        docNo: z.string().trim().regex(/^[A-Z0-9-]{4,32}$/, "Doküman no biçimi geçersiz"),
        title: z.string().trim().min(5).max(200),
        category: z.enum(["Yasal", "Genel"]),
        pageCount: z.coerce.number().int().min(1).max(500).default(1),
      }).parse(req.body);
      if (!req.file) return res.status(400).json({ error: "PDF dosyası zorunlu" });
      if (!req.file.buffer.subarray(0, 5).equals(PDF_MAGIC))
        return res.status(400).json({ error: "Dosya içeriği PDF değil" });

      const sha = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const stored = `${v.docNo}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.pdf`;
      await fs.mkdir(cfg.UPLOAD_DIR, { recursive: true });
      await fs.writeFile(path.join(cfg.UPLOAD_DIR, stored), req.file.buffer, { mode: 0o640 });

      const row = await db.one(
        `INSERT INTO documents (doc_no, title, version, category, status, uploaded_by, file_name, file_path, file_sha256, page_count)
         VALUES ($1,$2,'1.0',$3,'onayda',$4,$5,$6,$7,$8) RETURNING id`,
        [v.docNo, v.title, v.category, req.user.username, safeName(req.file.originalname), stored, sha, v.pageCount]
      );
      const insp = await inspector();
      await db.query(
        `INSERT INTO requests (kind, subject, category, requested_by, approver, reason, target_type, target_id)
         VALUES ('doc.publish',$1,$2,$3,$4,'Yeni doküman — Teftiş onayı','document',$5)`,
        [`${v.docNo} — ${v.title}`, v.category, req.user.username, insp, String(row.id)]
      );
      await audit.record("dokuman.onaya_gonderildi", req.user.username, { detail: { id: row.id, no: v.docNo, sha256: sha } });
      await notify.send("doc.submit", { subject: `${v.docNo} Teftiş onayı bekliyor`, requester: req.user.username, approver: insp }, cfg, req.user.username);
      res.status(201).json({ id: row.id });
    } catch (e) { next(e); }
  });

  /* Kaldırma yalnızca yükleyenin talebiyle, Teftiş onayıyla olur. */
  r.post("/:id/delete-request", requireScreen("k.docs", "read"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const reason = z.string().trim().min(10).max(2000).parse(req.body.reason);
      const d = await db.one("SELECT * FROM documents WHERE id=$1", [id]);
      if (!d) return res.status(404).json({ error: "Bulunamadı" });
      if (d.uploaded_by !== req.user.username)
        return res.status(403).json({ error: "Kaldırma talebini yalnızca dokümanı yükleyen açabilir" });
      if (d.pending_delete) return res.status(409).json({ error: "Bekleyen kaldırma talebi var" });
      const insp = await inspector();
      await db.query("UPDATE documents SET pending_delete = TRUE WHERE id=$1", [id]);
      await db.query(
        `INSERT INTO requests (kind, subject, category, requested_by, approver, reason, target_type, target_id)
         VALUES ('doc.delete',$1,$2,$3,$4,$5,'document',$6)`,
        [`${d.doc_no} — ${d.title}`, d.category, req.user.username, insp, reason, String(id)]
      );
      await audit.record("dokuman.kaldirma_talebi", req.user.username, { detail: { id, no: d.doc_no } });
      await notify.send("doc.delreq", { subject: `${d.doc_no} için kaldırma talebi onayda`, requester: req.user.username, approver: insp }, cfg, req.user.username);
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  /* Onay bekleyen kaydın dosyasını yalnızca yükleyen değiştirir; sürüm artmaz, kayıt onayda kalır. */
  r.put("/:id/file", requireScreen("k.docs"), upload.single("file"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const d = await db.one("SELECT * FROM documents WHERE id=$1", [id]);
      if (!d) return res.status(404).json({ error: "Bulunamadı" });
      if (d.uploaded_by !== req.user.username)
        return res.status(403).json({ error: "Dosyayı yalnızca yükleyen kişi değiştirebilir" });
      if (d.status === "yayinda")
        return res.status(409).json({ error: "Yayında olan dokümanda dosya değiştirilemez; yeni sürüm gerekir" });
      if (!req.file) return res.status(400).json({ error: "PDF dosyası zorunlu" });
      if (!req.file.buffer.subarray(0, 5).equals(PDF_MAGIC))
        return res.status(400).json({ error: "Dosya içeriği PDF değil" });

      const sha = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const stored = `${d.doc_no}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.pdf`;
      await fs.mkdir(cfg.UPLOAD_DIR, { recursive: true });
      await fs.writeFile(path.join(cfg.UPLOAD_DIR, stored), req.file.buffer, { mode: 0o640 });
      const old = d.file_path;
      await db.query(
        `UPDATE documents SET file_name=$1, file_path=$2, file_sha256=$3, status='onayda', reject_reason=NULL
          WHERE id=$4`,
        [safeName(req.file.originalname), stored, sha, id]);
      if (old && STORED_NAME.test(old)) await fs.unlink(path.join(cfg.UPLOAD_DIR, old)).catch(() => {});
      await audit.record("dokuman.dosya_degistirildi", req.user.username, { detail: { id, no: d.doc_no, sha256: sha } });
      const insp = await inspector();
      await notify.send("doc.submit", { subject: `${d.doc_no} dosyası güncellendi, onay bekliyor`,
        requester: req.user.username, approver: insp }, cfg, req.user.username);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* Onay bekleyen kaydı yükleyen doğrudan siler (henüz yayına girmediği için onay gerekmez).
     Yayında olan doküman için silme değil, gerekçeli kaldırma talebi açılır. */
  r.delete("/:id", requireScreen("k.docs"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const d = await db.one("SELECT * FROM documents WHERE id=$1", [id]);
      if (!d) return res.status(404).json({ error: "Bulunamadı" });
      if (d.uploaded_by !== req.user.username)
        return res.status(403).json({ error: "Kaydı yalnızca yükleyen kişi silebilir" });
      if (d.status === "yayinda")
        return res.status(409).json({ error: "Yayında olan doküman için kaldırma talebi açılmalıdır" });

      await db.query("UPDATE requests SET status='geri_cekildi', decided_at=now() WHERE target_type='document' AND target_id=$1 AND status='bekliyor'", [String(id)]);
      await db.query("DELETE FROM documents WHERE id=$1", [id]);
      if (d.file_path && STORED_NAME.test(d.file_path))
        await fs.unlink(path.join(cfg.UPLOAD_DIR, d.file_path)).catch(() => {});
      await audit.record("dokuman.onay_oncesi_silindi", req.user.username, { ok: false, detail: { id, no: d.doc_no } });
      const insp = await inspector();
      await notify.send("doc.delreq", { subject: `${d.doc_no} onay talebi yükleyen tarafından iptal edildi`,
        requester: req.user.username, approver: insp }, cfg, req.user.username);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* --- Okuma oturumu: süre sunucuda tutulur --- */
  r.post("/:id/reading/start", requireScreen("k.docs"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const d = await db.one("SELECT * FROM documents WHERE id=$1 AND status='yayinda'", [id]);
      if (!d) return res.status(404).json({ error: "Bulunamadı" });
      const sid = crypto.randomBytes(16).toString("hex");
      await db.query("INSERT INTO reading_sessions (id, username, doc_id) VALUES ($1,$2,$3)", [sid, req.user.username, id]);
      res.status(201).json({ sessionId: sid, secondsPerPage: cfg.READING_SECONDS_PER_PAGE, pageCount: d.page_count });
    } catch (e) { next(e); }
  });

  /* İstemci her sayfada düzenli ping atar; süre iki ping arasındaki gerçek farktan hesaplanır,
     istemcinin bildirdiği süre kabul edilmez. */
  r.post("/reading/:sid/ping", requireScreen("k.docs"), async (req, res, next) => {
    try {
      const sid = z.string().regex(/^[a-f0-9]{32}$/).parse(req.params.sid);
      const page = z.coerce.number().int().min(0).max(500).parse(req.body.page);
      const s = await db.one("SELECT * FROM reading_sessions WHERE id=$1 AND username=$2", [sid, req.user.username]);
      if (!s) return res.status(404).json({ error: "Oturum yok" });
      const delta = Math.min(15, Math.max(0, Math.round((Date.now() - new Date(s.last_ping_at).getTime()) / 1000)));
      const secs = typeof s.page_seconds === "string" ? JSON.parse(s.page_seconds) : (s.page_seconds || {});
      secs[page] = (secs[page] || 0) + delta;
      await db.query("UPDATE reading_sessions SET page_seconds=$1, last_ping_at=now() WHERE id=$2", [JSON.stringify(secs), sid]);
      res.json({ pageSeconds: secs, required: cfg.READING_SECONDS_PER_PAGE });
    } catch (e) { next(e); }
  });

  r.post("/reading/:sid/ack", requireScreen("k.docs"), async (req, res, next) => {
    try {
      const sid = z.string().regex(/^[a-f0-9]{32}$/).parse(req.params.sid);
      const s = await db.one("SELECT * FROM reading_sessions WHERE id=$1 AND username=$2", [sid, req.user.username]);
      if (!s) return res.status(404).json({ error: "Oturum yok" });
      const d = await db.one("SELECT * FROM documents WHERE id=$1", [s.doc_id]);
      const secs = typeof s.page_seconds === "string" ? JSON.parse(s.page_seconds) : (s.page_seconds || {});
      const total = Object.values(secs).reduce((a, b) => a + b, 0);
      const missing = [];
      for (let p = 0; p < d.page_count; p++)
        if ((secs[p] || 0) < cfg.READING_SECONDS_PER_PAGE) missing.push(p + 1);
      if (missing.length)
        return res.status(422).json({ error: "Okuma süresi tamamlanmadı", missingPages: missing, required: cfg.READING_SECONDS_PER_PAGE });
      await db.query(
        `INSERT INTO document_acks (doc_no, version, username, seconds_spent) VALUES ($1,$2,$3,$4)
         ON CONFLICT (doc_no, version, username) DO NOTHING`,
        [d.doc_no, d.version, req.user.username, total]);
      await db.query("UPDATE reading_sessions SET completed_at=now() WHERE id=$1", [sid]);
      await audit.record("dokuman.okundu", req.user.username, { detail: { no: d.doc_no, surum: d.version, saniye: total } });
      res.json({ ok: true, seconds: total });
    } catch (e) { next(e); }
  });

  return r;
};
