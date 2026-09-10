"use strict";
/* Raporlar modülü. Rapor motoru ayrı BI servisinde (PRISMA) çalışır.
   Portalın sorumluluğu: katalog, yaşam döngüsü (geliştirme → onay → yayın → emekli),
   yetki kontrolü, BI'a kimlik devri ve denetim izi. */
const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const notify = require("../services/notify");
const { requireScreen, isInspection } = require("../middleware/auth");

module.exports = function (cfg) {
  const r = express.Router();

  const visibleTo = (rep, user) => {
    const roles = typeof rep.allowed_roles === "string" ? JSON.parse(rep.allowed_roles) : (rep.allowed_roles || []);
    return roles.length === 0 || roles.includes(user.role_key);
  };

  async function inspector() {
    const i = await db.one("SELECT username FROM users WHERE role_key='inspection' AND active ORDER BY username LIMIT 1");
    if (!i) throw Object.assign(new Error("Teftiş rolünde aktif kullanıcı yok"), { status: 409 });
    return i.username;
  }

  /* Katalog: yayında olan raporlar rol filtresiyle; geliştirme aşamasındakiler
     yalnızca sahibine, sahibinin yöneticisine ve Teftiş'e görünür. */
  r.get("/", requireScreen("r.list"), async (req, res) => {
    const rows = await db.many(
      `SELECT b.id, b.code, b.name, b.area, b.frequency, b.description, b.status, b.version,
              b.owner, b.allowed_roles, b.reject_reason, b.published_at, b.entry_type
         FROM bi_reports b
         JOIN users u ON u.username = b.owner
        WHERE b.status = 'yayinda'
           OR b.owner = $1
           OR u.manager = $1
           OR $2 = TRUE
        ORDER BY b.status, b.code`,
      [req.user.username, isInspection(req)]);
    res.json({ items: rows.filter((x) => x.status !== "yayinda" || visibleTo(x, req.user)) });
  });

  /* Rapor açma: portal kısa ömürlü imzalı bir devir anahtarı üretir, BI bunu doğrular.
     Anahtar kullanıcı adı, rol, rapor kodu ve son geçerlilik içerir; 60 saniye geçerlidir. */
  r.post("/:id/open", requireScreen("r.view"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const rep = await db.one("SELECT * FROM bi_reports WHERE id=$1", [id]);
      if (!rep) return res.status(404).json({ error: "Bulunamadı" });
      if (rep.status !== "yayinda") return res.status(409).json({ error: "Rapor henüz yayında değil" });
      if (!visibleTo(rep, req.user)) return res.status(404).json({ error: "Bulunamadı" });

      const exp = Date.now() + 60000;
      /* Tek kullanımlık: nonce veritabanına yazılır, BI doğrulamasında tüketilir. */
      const nonce = crypto.randomBytes(16).toString("hex");
      await db.query(
        "INSERT INTO sso_nonces (nonce, username, report_code, expires_at) VALUES ($1,$2,$3,$4)",
        [nonce, req.user.username, rep.code, new Date(exp).toISOString()]);
      const payload = [req.user.username, req.user.role_key, rep.code, String(exp), nonce].join("|");
      const sig = crypto.createHmac("sha256", Buffer.from(cfg.APP_ENCRYPTION_KEY, "base64"))
        .update(payload).digest("base64url");
      const token = Buffer.from(payload).toString("base64url") + "." + sig;

      await db.query("INSERT INTO bi_report_opens (report_id, username, ip) VALUES ($1,$2,$3)",
        [id, req.user.username, req.ip || null]);
      await audit.record("rapor.acildi", req.user.username, { detail: { kod: rep.code, surum: rep.version } });

      const base = String(cfg.BI_BASE_URL || "").replace(/\/+$/, "");
      /* Rapor yolu katalogdan gelir; istek verisi URL'e karışmaz. */
      const path = String(rep.bi_path).replace(/[^A-Za-z0-9/_-]/g, "");
      res.json({ url: base ? `${base}/${path}` : null, token, expiresAt: new Date(exp).toISOString() });
    } catch (e) { next(e); }
  });

  /* BI servisinin çağırdığı doğrulama ucu: anahtarı tüketir ve kimlik bilgisini döner.
     Aynı anahtar ikinci kez kabul edilmez. Bu uç oturum gerektirmez; imza ve nonce yeterlidir. */
  r.post("/sso/consume", async (req, res, next) => {
    try {
      const token = z.string().min(20).max(2000).parse(req.body.token);
      const [b64, sig] = String(token).split(".");
      if (!b64 || !sig) return res.status(400).json({ ok: false, error: "Anahtar biçimi geçersiz" });
      const payload = Buffer.from(b64, "base64url").toString("utf8");
      const expect = crypto.createHmac("sha256", Buffer.from(cfg.APP_ENCRYPTION_KEY, "base64"))
        .update(payload).digest("base64url");
      const a = Buffer.from(sig), b = Buffer.from(expect);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
        return res.status(401).json({ ok: false, error: "İmza doğrulanamadı" });

      const [username, role, code, exp, nonce] = payload.split("|");
      if (!nonce || Number(exp) < Date.now())
        return res.status(401).json({ ok: false, error: "Anahtarın süresi geçmiş" });

      const row = await db.one(
        `UPDATE sso_nonces SET used_at = now()
          WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING nonce`, [nonce]);
      if (!row) return res.status(409).json({ ok: false, error: "Anahtar daha önce kullanılmış" });

      await audit.record("rapor.sso_dogrulandi", username, { detail: { kod: code, rol: role } });
      res.json({ ok: true, username, role, reportCode: code });
    } catch (e) { next(e); }
  });

  /* --- geliştirme --- */
  const devSchema = z.object({
    code: z.string().trim().regex(/^[A-Z]{2,5}-\d{2,4}$/, "Kod biçimi RPT-014 gibi olmalı"),
    name: z.string().trim().min(5).max(160),
    area: z.string().trim().min(2).max(60),
    frequency: z.enum(["anlık", "günlük", "haftalık", "aylık", "üç aylık"]),
    description: z.string().trim().max(2000).optional(),
    biPath: z.string().trim().regex(/^[A-Za-z0-9/_-]{3,200}$/, "BI yolu yalnızca harf, rakam, / _ - içerebilir"),
    allowedRoles: z.array(z.string().max(32)).max(20).default([]),
    /* 'rapor' tek bir rapordur; 'modul' PRISMA'nın bir bölümünü portal altından açar. */
    entryType: z.enum(["rapor", "modul"]).default("rapor"),
  });

  r.get("/drafts", requireScreen("r.dev"), async (req, res) => {
    const rows = await db.many(
      `SELECT b.* FROM bi_reports b JOIN users u ON u.username=b.owner
        WHERE b.status <> 'yayinda' AND (b.owner=$1 OR u.manager=$1 OR $2=TRUE)
        ORDER BY b.created_at DESC`,
      [req.user.username, isInspection(req)]);
    res.json({ items: rows });
  });

  r.post("/", requireScreen("r.dev", "write"), async (req, res, next) => {
    try {
      const v = devSchema.parse(req.body);
      const row = await db.one(
        `INSERT INTO bi_reports (code, name, area, frequency, description, bi_path, owner, allowed_roles, status, entry_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'gelistirme',$9) RETURNING id`,
        [v.code, v.name, v.area, v.frequency, v.description || null, v.biPath, req.user.username,
         JSON.stringify(v.allowedRoles), v.entryType]);
      await audit.record("rapor.olusturuldu", req.user.username, { detail: { kod: v.code } });
      res.status(201).json({ id: row.id });
    } catch (e) { next(e); }
  });

  /* Geliştirme aşamasındaki raporu yalnızca sahibi değiştirir. */
  r.put("/:id", requireScreen("r.dev", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const rep = await db.one("SELECT * FROM bi_reports WHERE id=$1", [id]);
      if (!rep) return res.status(404).json({ error: "Bulunamadı" });
      if (rep.owner !== req.user.username)
        return res.status(403).json({ error: "Raporu yalnızca sahibi değiştirebilir" });
      if (rep.status === "yayinda")
        return res.status(409).json({ error: "Yayında olan rapor için yeni sürüm onayı gerekir" });
      const v = devSchema.parse(req.body);
      await db.query(
        `UPDATE bi_reports SET code=$1, name=$2, area=$3, frequency=$4, description=$5, bi_path=$6,
                allowed_roles=$7, entry_type=$8, status='gelistirme', reject_reason=NULL WHERE id=$9`,
        [v.code, v.name, v.area, v.frequency, v.description || null, v.biPath,
         JSON.stringify(v.allowedRoles), v.entryType, id]);
      await audit.record("rapor.guncellendi", req.user.username, { detail: { kod: v.code } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.delete("/:id", requireScreen("r.dev", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const rep = await db.one("SELECT * FROM bi_reports WHERE id=$1", [id]);
      if (!rep) return res.status(404).json({ error: "Bulunamadı" });
      if (rep.owner !== req.user.username)
        return res.status(403).json({ error: "Raporu yalnızca sahibi silebilir" });
      if (rep.status === "yayinda")
        return res.status(409).json({ error: "Yayında olan rapor için emekliye alma talebi açılmalıdır" });
      await db.query("UPDATE requests SET status='geri_cekildi', decided_at=now() WHERE target_type='report' AND target_id=$1 AND status='bekliyor'", [String(id)]);
      await db.query("DELETE FROM bi_reports WHERE id=$1", [id]);
      await audit.record("rapor.silindi", req.user.username, { ok: false, detail: { kod: rep.code } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* --- yayınlama: doküman akışıyla aynı mantık, onay Teftiş'te --- */
  r.post("/:id/publish-request", requireScreen("r.dev", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const reason = z.string().trim().min(10).max(2000).parse(req.body.reason);
      const rep = await db.one("SELECT * FROM bi_reports WHERE id=$1", [id]);
      if (!rep) return res.status(404).json({ error: "Bulunamadı" });
      if (rep.owner !== req.user.username)
        return res.status(403).json({ error: "Yayın talebini yalnızca rapor sahibi açabilir" });
      if (rep.status === "yayinda") return res.status(409).json({ error: "Rapor zaten yayında" });
      const open = await db.one(
        "SELECT 1 FROM requests WHERE target_type='report' AND target_id=$1 AND status='bekliyor'", [String(id)]);
      if (open) return res.status(409).json({ error: "Bu rapor için bekleyen talep var" });

      const insp = await inspector();
      await db.query("UPDATE bi_reports SET status='onayda' WHERE id=$1", [id]);
      await db.query(
        `INSERT INTO requests (kind, subject, category, requested_by, approver, reason, target_type, target_id)
         VALUES ('report.publish',$1,'Genel',$2,$3,$4,'report',$5)`,
        [`${rep.code} — ${rep.name}`, req.user.username, insp, reason, String(id)]);
      await audit.record("rapor.yayin_talebi", req.user.username, { detail: { kod: rep.code } });
      await notify.send("report.submit", { subject: `${rep.code} rapor yayın onayı bekliyor`,
        requester: req.user.username, approver: insp }, cfg, req.user.username);
      res.status(201).json({ ok: true, approver: insp });
    } catch (e) { next(e); }
  });

  r.post("/:id/retire-request", requireScreen("r.dev", "write"), async (req, res, next) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const reason = z.string().trim().min(10).max(2000).parse(req.body.reason);
      const rep = await db.one("SELECT * FROM bi_reports WHERE id=$1 AND status='yayinda'", [id]);
      if (!rep) return res.status(404).json({ error: "Bulunamadı" });
      if (rep.owner !== req.user.username)
        return res.status(403).json({ error: "Emekliye alma talebini yalnızca rapor sahibi açabilir" });
      const insp = await inspector();
      await db.query(
        `INSERT INTO requests (kind, subject, category, requested_by, approver, reason, target_type, target_id)
         VALUES ('report.retire',$1,'Genel',$2,$3,$4,'report',$5)`,
        [`${rep.code} — ${rep.name}`, req.user.username, insp, reason, String(id)]);
      await audit.record("rapor.emeklilik_talebi", req.user.username, { detail: { kod: rep.code } });
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  /* Kullanım raporu: hangi raporu kim ne sıklıkla açtı */
  r.get("/usage", requireScreen("r.usage"), async (req, res) => {
    const rows = await db.many(
      `SELECT b.code, b.name, b.status, COUNT(o.id)::int AS opens,
              COUNT(DISTINCT o.username)::int AS users, MAX(o.at) AS last_open
         FROM bi_reports b LEFT JOIN bi_report_opens o ON o.report_id = b.id
        GROUP BY b.id, b.code, b.name, b.status ORDER BY opens DESC, b.code`);
    res.json({ items: rows });
  });

  return r;
};
