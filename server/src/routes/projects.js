"use strict";
const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const projects = require("../lib/projects");
const projectDocs = require("../lib/projectDocs");
const access = require("../services/access");
const { requireScreen, requireProjectScreen, requireAuth, ALL_PROJECT_ROLES } = require("../middleware/auth");

const PDF_MAGIC = Buffer.from("%PDF-");
const STORED_NAME = /^[A-Z0-9-]{1,32}_\d{10,16}_[a-f0-9]{12}\.pdf$/;
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

  r.get("/:id", requireProjectScreen("d.projects"), async (req, res, next) => {
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

  /* Not: faz kapısı (stage gate) uçları burada değil, server/src/routes/gates.js'te
     (/api/gates/...) — client oradan çağırır. Bu dosyada daha önce aynı işlevin
     üretim şemasıyla uyuşmayan (var olmayan passed_by/passed_rule/authority sütunlarına
     başvuran), hiçbir yerde çağrılmayan ölü ve bozuk bir kopyası vardı; kaldırıldı
     (2026 salt-okunur erişim çalışması sırasında fark edildi — bkz. ilerleme raporu). */

  /* --- Proje dokümanları (d.docs, d.docview) ---
     Sabit tip listesi ve sıra kuralı: bir tip, kendinden önceki tip onaylanmadan
     yüklenemez (Proje Kartı → BRD → FRD → UAT → Go Live → Risk ve Uyumluluk → Kapanış).
     Altı adımlı onay zinciri lib/projectDocs.js'te. d.docs ekranına proje ekibinin
     tüm rolleri (Internal Audit ve Risk dahil — "dokümanlar üzerinden çalışır") erişir. */
  r.get("/:id/documents", requireProjectScreen("d.docs", { eligibleRoles: ALL_PROJECT_ROLES }), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const p = await db.one("SELECT id FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });
      const rows = await db.many(
        `SELECT id, doc_type, title, version, status, current_step, reject_reason,
                uploaded_by, uploaded_at, effective_date, file_name
           FROM project_documents WHERE project_id = $1`,
        [id]);
      rows.sort((a, b) => projectDocs.DOC_TYPE_ORDER.indexOf(a.doc_type) - projectDocs.DOC_TYPE_ORDER.indexOf(b.doc_type));
      res.json({ items: rows, typeOrder: projectDocs.DOC_TYPE_ORDER });
    } catch (e) { next(e); }
  });

  async function readableDoc(req, docId) {
    const d = await db.one("SELECT * FROM project_documents WHERE id=$1", [docId]);
    if (!d) return { code: 404 };
    const eligible = await db.one(
      "SELECT 1 FROM project_members WHERE project_id=$1 AND username=$2", [d.project_id, req.user.username]);
    const hasRoleAccess = access.level(req.access, "d.docs") !== "none";
    if (!eligible && !hasRoleAccess) return { code: 404 };
    return { doc: d };
  }

  r.get("/:id/documents/:docId", requireProjectScreen("d.docs", { eligibleRoles: ALL_PROJECT_ROLES }), async (req, res, next) => {
    try {
      const docId = z.coerce.number().int().positive().parse(req.params.docId);
      const { doc, code } = await readableDoc(req, docId);
      if (code) return res.status(code).json({ error: "Bulunamadı" });
      const approvals = await db.many(
        `SELECT a.step_no, a.step_name, a.approver_username, u.display_name, a.is_proxy, a.approved_at
           FROM project_document_approvals a JOIN users u ON u.username = a.approver_username
          WHERE a.document_id = $1 ORDER BY a.step_no`, [docId]);
      const next6 = doc.status === "onay_akisinda" ? await projectDocs.expectedApprover(doc.project_id, doc.current_step) : null;
      res.json({ item: doc, approvals, nextApprover: next6 });
    } catch (e) { next(e); }
  });

  r.get("/:id/documents/:docId/file", requireProjectScreen("d.docview", { eligibleRoles: ALL_PROJECT_ROLES }), async (req, res, next) => {
    try {
      const docId = z.coerce.number().int().positive().parse(req.params.docId);
      const { doc, code } = await readableDoc(req, docId);
      if (code) return res.status(code).json({ error: "Bulunamadı" });
      if (!STORED_NAME.test(doc.file_path)) return res.status(400).json({ error: "Geçersiz dosya kaydı" });
      const abs = path.resolve(cfg.UPLOAD_DIR, path.basename(doc.file_path));
      if (!abs.startsWith(path.resolve(cfg.UPLOAD_DIR) + path.sep)) return res.status(400).json({ error: "Geçersiz yol" });
      const safe = `${String(doc.doc_type).replace(/[^A-Za-z0-9-]/g, "_")}_v${String(doc.version).replace(/[^0-9.]/g, "")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${safe}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; object-src 'none'; sandbox");
      res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.sendFile(abs);
    } catch (e) { next(e); }
  });

  /* Yükleme: pmdir/pm (d.docs write) VEYA projenin Product Owner'ı — ilk onay adımı
     zaten Ürün Sahibi olduğu için içeriği o hazırlıyor sayılır. */
  r.post("/:id/documents", upload.single("file"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const p = await db.one("SELECT id FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });

      const canWriteRole = access.canWrite(req.access, "d.docs");
      const po = await projectDocs.memberWithRole(id, "Product Owner");
      if (!canWriteRole && req.user.username !== po)
        return res.status(403).json({ error: "Yalnızca Proje Yöneticisi/Direktörü veya projenin Ürün Sahibi doküman yükleyebilir" });

      const v = z.object({
        docType: z.enum(projectDocs.DOC_TYPE_ORDER),
        title: z.string().trim().min(5).max(200),
      }).parse(req.body);
      if (!req.file) return res.status(400).json({ error: "PDF dosyası zorunlu" });
      if (!req.file.buffer.subarray(0, 5).equals(PDF_MAGIC))
        return res.status(400).json({ error: "Dosya içeriği PDF değil" });

      const existing = await db.one("SELECT id, status FROM project_documents WHERE project_id=$1 AND doc_type=$2", [id, v.docType]);
      if (existing && existing.status !== "reddedildi")
        return res.status(409).json({ error: "Bu tipte zaten onay akışında veya onaylanmış bir doküman var" });

      const approvedRows = await db.many("SELECT doc_type FROM project_documents WHERE project_id=$1 AND status='onaylandi'", [id]);
      const approvedTypes = new Set(approvedRows.map((r) => r.doc_type));
      if (!projectDocs.nextTypeAllowed(approvedTypes, v.docType)) {
        const idx = projectDocs.DOC_TYPE_ORDER.indexOf(v.docType);
        return res.status(409).json({
          error: `Sıra kuralı: önce "${projectDocs.DOC_TYPE_ORDER[idx - 1]}" onaylanmalı`,
        });
      }

      const sha = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
      const stored = `${String(p.id)}-${v.docType.replace(/[^A-Za-z0-9]/g, "")}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.pdf`;
      await fs.mkdir(cfg.UPLOAD_DIR, { recursive: true });
      await fs.writeFile(path.join(cfg.UPLOAD_DIR, stored), req.file.buffer, { mode: 0o640 });

      let row;
      if (existing) {
        row = await db.one(
          `UPDATE project_documents
              SET title=$1, file_name=$2, file_path=$3, file_sha256=$4, status='onay_akisinda',
                  current_step=1, reject_reason=NULL, uploaded_by=$5, uploaded_at=now(), effective_date=NULL
            WHERE id=$6 RETURNING id`,
          [v.title, safeName(req.file.originalname), stored, sha, req.user.username, existing.id]);
      } else {
        row = await db.one(
          `INSERT INTO project_documents (project_id, doc_type, title, file_name, file_path, file_sha256, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [id, v.docType, v.title, safeName(req.file.originalname), stored, sha, req.user.username]);
      }
      await audit.record("proje_dokumani.yuklendi", req.user.username, { detail: { proje: id, tip: v.docType, sha256: sha } });
      res.status(201).json({ id: row.id });
    } catch (e) { next(e); }
  });

  r.post("/:id/documents/:docId/approve", requireAuth, async (req, res, next) => {
    try {
      const docId = z.coerce.number().int().positive().parse(req.params.docId);
      const d = await db.one("SELECT * FROM project_documents WHERE id=$1", [docId]);
      if (!d) return res.status(404).json({ error: "Bulunamadı" });
      if (d.status !== "onay_akisinda") return res.status(409).json({ error: "Bu doküman onay akışında değil" });

      const { allowed, isProxy } = await projectDocs.canApproveStep(req.user, d.project_id, d.current_step);
      if (!allowed) {
        const step = projectDocs.stepAt(d.current_step);
        return res.status(403).json({ error: `Bu adımı yalnızca "${step.name}" onaylayabilir` });
      }
      const step = projectDocs.stepAt(d.current_step);
      await db.query(
        `INSERT INTO project_document_approvals (document_id, step_no, step_name, approver_username, is_proxy)
         VALUES ($1,$2,$3,$4,$5)`,
        [docId, step.no, step.name, req.user.username, isProxy]);

      const finished = step.no === 6;
      await db.query(
        finished
          ? `UPDATE project_documents SET status='onaylandi', effective_date=now() WHERE id=$1`
          : `UPDATE project_documents SET current_step = current_step + 1 WHERE id=$1`,
        [docId]);
      await audit.record(isProxy ? "proje_dokumani.vekaleten_onay" : "proje_dokumani.onay", req.user.username,
        { detail: { doküman: docId, adim: step.name, vekalet: isProxy, tamamlandi: finished } });
      res.json({ ok: true, finished, step: step.no });
    } catch (e) { next(e); }
  });

  r.post("/:id/documents/:docId/reject", requireAuth, async (req, res, next) => {
    try {
      const docId = z.coerce.number().int().positive().parse(req.params.docId);
      const reason = z.string().trim().min(10).max(2000).parse(req.body.reason);
      const d = await db.one("SELECT * FROM project_documents WHERE id=$1", [docId]);
      if (!d) return res.status(404).json({ error: "Bulunamadı" });
      if (d.status !== "onay_akisinda") return res.status(409).json({ error: "Bu doküman onay akışında değil" });

      const { allowed } = await projectDocs.canApproveStep(req.user, d.project_id, d.current_step);
      if (!allowed) {
        const step = projectDocs.stepAt(d.current_step);
        return res.status(403).json({ error: `Bu adımı yalnızca "${step.name}" reddedebilir` });
      }
      await db.query("UPDATE project_documents SET status='reddedildi', reject_reason=$1 WHERE id=$2", [reason, docId]);
      await audit.record("proje_dokumani.reddedildi", req.user.username, { detail: { doküman: docId, gerekce: reason } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* --- proje ekleme ve silme (tam yetki gerektirir) --- */
  const projSchema = z.object({
    code: z.string().trim().regex(/^[A-Z]{2,10}$/, "Proje kodu 2-10 büyük harf olmalı"),
    name: z.string().trim().min(5).max(160),
    method: z.enum(["Scrum", "Kanban", "Waterfall"]),
    lead: z.string().trim().regex(/^[a-z0-9._-]{2,64}$/),
    unitCode: z.string().trim().max(16).nullable().optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  });

  r.post("/", requireScreen("d.projects", "write"), async (req, res, next) => {
    try {
      const v = projSchema.parse(req.body);
      const lead = await db.one("SELECT username FROM users WHERE username=$1 AND active", [v.lead]);
      if (!lead) return res.status(400).json({ error: "Proje sorumlusu tanımlı ve aktif olmalı" });
      const row = await db.one(
        `INSERT INTO projects (code, name, method, lead, unit_code, start_date, target_date, status, health)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'devam','planinda') RETURNING id`,
        [v.code, v.name, v.method, v.lead, v.unitCode || null, v.startDate || null, v.targetDate || null]);
      await audit.record("proje.olusturuldu", req.user.username, { detail: { kod: v.code, yontem: v.method } });
      /* Internal Audit ve Risk otomatik olarak zorunlu üye eklenir (CHANGELOG 1.13.1). */
      await projects.ensureMandatoryMembers(row.id);
      res.status(201).json({ id: row.id });
    } catch (e) { next(e); }
  });

  /* --- Proje ekibi ---
     Internal Audit ve Risk zorunlu üyedir, çıkarılamaz. Diğer yedi rolden (Project Manager,
     Developer, QA, Business Owner, Product Owner, Vendor, Analyst) istenildiği kadar eklenebilir.
     GET her zaman mevcut projelerde eksik zorunlu üyeliği tamamlar (lazy backfill); böylece
     10_project_team.sql'den önce oluşturulmuş projeler de otomatik tamamlanır. */
  const memberSchema = z.object({
    username: z.string().trim().regex(/^[a-z0-9._-]{2,64}$/),
    projectRole: z.enum([
      "Project Manager", "Developer", "QA", "Business Owner", "Product Owner",
      "Internal Audit", "Risk", "Vendor", "Analyst",
    ]),
  });

  r.get("/:id/team", requireScreen("d.team"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const p = await db.one("SELECT id FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });
      await projects.ensureMandatoryMembers(id);
      res.json({ items: await projects.teamOf(id) });
    } catch (e) { next(e); }
  });

  r.post("/:id/team", requireScreen("d.team", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const v = memberSchema.parse(req.body);
      if (v.projectRole === "Internal Audit" || v.projectRole === "Risk")
        return res.status(400).json({
          error: "Internal Audit ve Risk üyeliği otomatik atanır, elle eklenemez",
        });
      const p = await db.one("SELECT id FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });
      const u = await db.one("SELECT username FROM users WHERE username=$1 AND active", [v.username]);
      if (!u) return res.status(400).json({ error: "Kullanıcı tanımlı ve aktif olmalı" });
      const existing = await db.one("SELECT username FROM project_members WHERE project_id=$1 AND username=$2", [id, v.username]);
      if (existing) return res.status(409).json({ error: "Kullanıcı zaten bu projenin ekibinde" });
      await db.query(
        `INSERT INTO project_members (project_id, username, project_role, is_mandatory, added_by)
         VALUES ($1,$2,$3,FALSE,$4)`,
        [id, v.username, v.projectRole, req.user.username]);
      await audit.record("ekip.uye_eklendi", req.user.username,
        { detail: { proje: id, kullanici: v.username, rol: v.projectRole } });
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  r.delete("/:id/team/:username", requireScreen("d.team", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const username = z.string().trim().regex(/^[a-z0-9._-]{2,64}$/).parse(req.params.username);
      const m = await db.one("SELECT is_mandatory, project_role FROM project_members WHERE project_id=$1 AND username=$2", [id, username]);
      if (!m) return res.status(404).json({ error: "Bulunamadı" });
      if (m.is_mandatory)
        return res.status(409).json({ error: `${m.project_role} zorunlu ekip üyesidir, çıkarılamaz` });
      await db.query("DELETE FROM project_members WHERE project_id=$1 AND username=$2", [id, username]);
      await audit.record("ekip.uye_cikarildi", req.user.username, { detail: { proje: id, kullanici: username } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.delete("/:id", requireScreen("d.projects", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      /* Silme ayrı bir yetkidir: proje yöneticisi ekler ve değiştirir, silmeyi direktör yapar. */
      if (!access.canWrite(req.access, "d.delete"))
        return res.status(403).json({ error: "Proje silme yetkisi yalnızca Proje Yönetim Direktörü'ndedir" });
      const p = await db.one("SELECT code, name FROM projects WHERE id=$1", [id]);
      if (!p) return res.status(404).json({ error: "Bulunamadı" });
      await db.query("DELETE FROM projects WHERE id=$1", [id]);
      await audit.record("proje.silindi", req.user.username, { ok: false, detail: { kod: p.code, ad: p.name } });
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
