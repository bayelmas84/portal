"use strict";
const express = require("express");
const { z } = require("zod");
const db = require("../lib/db");
const audit = require("../lib/audit");
const access = require("../services/access");
const { requireScreen } = require("../middleware/auth");

module.exports = function (cfg) {
  const r = express.Router();

  /* ---- kullanıcılar ---- */
  r.get("/users", requireScreen("m.users"), async (req, res) => {
    res.json({ items: await db.many(
      `SELECT u.username, u.display_name, u.role_key, u.unit_code, u.title_code, u.manager, u.active, u.email,
              un.name AS unit_name, t.name AS title_name
         FROM users u LEFT JOIN units un ON un.code=u.unit_code LEFT JOIN titles t ON t.code=u.title_code
        ORDER BY u.display_name`) });
  });

  const userSchema = z.object({
    username: z.string().trim().regex(/^[a-z0-9._-]{2,64}$/),
    displayName: z.string().trim().min(3).max(120),
    roleKey: z.string().trim().min(2).max(32),
    unitCode: z.string().trim().max(16).nullable().optional(),
    titleCode: z.string().trim().max(16).nullable().optional(),
    manager: z.string().trim().max(64).nullable().optional(),
    active: z.boolean().default(true),
  });

  r.post("/users", requireScreen("m.users", "write"), async (req, res, next) => {
    try {
      const v = userSchema.parse(req.body);
      const role = await db.one("SELECT key FROM roles WHERE key=$1", [v.roleKey]);
      if (!role) return res.status(400).json({ error: "Tanımsız rol" });
      await db.query(
        `INSERT INTO users (username, display_name, role_key, unit_code, title_code, manager, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [v.username, v.displayName, v.roleKey, v.unitCode || null, v.titleCode || null, v.manager || null, v.active]);
      await audit.record("kullanici.eklendi", req.user.username, { detail: { username: v.username, rol: v.roleKey } });
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  r.put("/users/:username", requireScreen("m.users", "write"), async (req, res, next) => {
    try {
      const username = z.string().regex(/^[a-z0-9._-]{2,64}$/).parse(req.params.username);
      const v = userSchema.partial({ username: true }).parse({ ...req.body, username });
      /* Yönetici kendi rolünü değiştiremez (yetki yükseltme engeli). */
      if (username === req.user.username && v.roleKey && v.roleKey !== req.user.role_key)
        return res.status(403).json({ error: "Kendi rolünüzü değiştiremezsiniz" });
      await db.query(
        `UPDATE users SET display_name=$1, role_key=$2, unit_code=$3, title_code=$4, manager=$5, active=$6
          WHERE username=$7`,
        [v.displayName, v.roleKey, v.unitCode || null, v.titleCode || null, v.manager || null, v.active, username]);
      if (v.active === false) await db.query("UPDATE sessions SET revoked_at=now() WHERE username=$1 AND revoked_at IS NULL", [username]);
      await audit.record("kullanici.guncellendi", req.user.username, { detail: { username, aktif: v.active } });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ---- rol / ekran yetkileri ---- */
  r.get("/permissions", requireScreen("m.access"), async (req, res) => {
    const roles = await db.many("SELECT key, label FROM roles ORDER BY key");
    const perms = await db.many("SELECT role_key, screen_key, level FROM role_permissions");
    res.json({ roles, perms, modules: access.MODULES, screens: access.SCREENS });
  });

  r.put("/permissions", requireScreen("m.access", "write"), async (req, res, next) => {
    try {
      const v = z.object({
        roleKey: z.string().min(2).max(32),
        screenKey: z.string().min(2).max(32),
        level: z.enum(["none", "read", "write"]),
      }).parse(req.body);
      /* Görevler ayrılığı: kimse kendi rolünün yetkisini değiştiremez. */
      if (v.roleKey === req.user.role_key)
        return res.status(403).json({ error: "Kendi rolünüzün yetkilerini değiştiremezsiniz" });
      if (v.level === "none") await db.query("DELETE FROM role_permissions WHERE role_key=$1 AND screen_key=$2", [v.roleKey, v.screenKey]);
      else await db.query(
        `INSERT INTO role_permissions (role_key, screen_key, level) VALUES ($1,$2,$3)
         ON CONFLICT (role_key, screen_key) DO UPDATE SET level = EXCLUDED.level`,
        [v.roleKey, v.screenKey, v.level]);
      await audit.record("yetki.degisti", req.user.username, { detail: v });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ---- ekran yönetimi (rolden bağımsız) ---- */
  r.get("/screens", requireScreen("m.avail"), async (req, res) => {
    res.json({ states: await access.screenStates(), modules: access.MODULES, screens: access.SCREENS });
  });

  r.put("/screens", requireScreen("m.avail", "write"), async (req, res, next) => {
    try {
      const v = z.object({
        key: z.string().min(2).max(32),
        state: z.enum(["acik", "bakim", "kapali"]),
      }).parse(req.body);
      if (access.UNCLOSABLE.has(v.key) && v.state !== "acik")
        return res.status(403).json({ error: "Admin Panel ve Ekran yönetimi kapatılamaz" });
      await db.query(
        `INSERT INTO screen_state (screen_key, state, changed_by, changed_at) VALUES ($1,$2,$3,now())
         ON CONFLICT (screen_key) DO UPDATE SET state=EXCLUDED.state, changed_by=EXCLUDED.changed_by, changed_at=now()`,
        [v.key, v.state, req.user.username]);
      await audit.record("ekran.durumu", req.user.username, { detail: v });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ---- bildirim tanımları ---- */
  r.get("/notifications", requireScreen("m.notif"), async (req, res) => {
    res.json({ items: await db.many("SELECT * FROM notification_defs ORDER BY event_key") });
  });

  r.put("/notifications", requireScreen("m.notif", "write"), async (req, res, next) => {
    try {
      const v = z.object({
        eventKey: z.string().min(3).max(64),
        field: z.enum(["to_req", "to_mgr", "to_appr", "to_insp", "to_all"]),
        value: z.boolean(),
      }).parse(req.body);
      const allowed = { to_req: 1, to_mgr: 1, to_appr: 1, to_insp: 1, to_all: 1 };
      if (!allowed[v.field]) return res.status(400).json({ error: "Geçersiz alan" });
      /* Alan adı sabit listeden seçilir; SQL'e kullanıcı girdisi eklenmez. */
      const sql = {
        to_req: "UPDATE notification_defs SET to_req=$1 WHERE event_key=$2",
        to_mgr: "UPDATE notification_defs SET to_mgr=$1 WHERE event_key=$2",
        to_appr: "UPDATE notification_defs SET to_appr=$1 WHERE event_key=$2",
        to_insp: "UPDATE notification_defs SET to_insp=$1 WHERE event_key=$2",
        to_all: "UPDATE notification_defs SET to_all=$1 WHERE event_key=$2",
      }[v.field];
      await db.query(sql, [v.value, v.eventKey]);
      await audit.record("bildirim.tanimi", req.user.username, { detail: v });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ---- Active Directory ayarları ---- */
  const dirconfig = require("../lib/dirconfig");
  const ldap = require("../services/ldap");

  r.get("/directory", requireScreen("m.dir"), async (req, res, next) => {
    try { res.json({ settings: await dirconfig.forDisplay(cfg), roles: (await db.many("SELECT key,label FROM roles ORDER BY key")) }); }
    catch (e) { next(e); }
  });

  const dirSchema = z.object({
    /* ldaps:// zorunlu değil ama şifresiz bağlantı üretimde reddedilir (aşağıda). */
    url: z.string().trim().regex(/^ldaps?:\/\/[a-zA-Z0-9._-]+(:\d{1,5})?$/, "Adres ldaps://sunucu:636 biçiminde olmalı"),
    baseDn: z.string().trim().min(3).max(255).regex(/^[A-Za-z0-9=,._\- ]+$/, "Base DN geçersiz karakter içeriyor"),
    bindDn: z.string().trim().min(3).max(255).regex(/^[A-Za-z0-9=,._\-@ ]+$/, "Bind DN geçersiz karakter içeriyor"),
    bindPassword: z.string().max(255).optional(),
    userFilter: z.string().trim().min(5).max(255).refine((v) => v.includes("{username}"),
      "Filtre {username} yer tutucusunu içermelidir"),
    tlsVerify: z.boolean().default(true),
    autoCreateUsers: z.boolean().default(false),
    defaultRole: z.string().trim().min(2).max(32),
    active: z.boolean().default(false),
  });

  r.put("/directory", requireScreen("m.dir", "write"), async (req, res, next) => {
    try {
      const v = dirSchema.parse(req.body);
      const role = await db.one("SELECT key FROM roles WHERE key=$1", [v.defaultRole]);
      if (!role) return res.status(400).json({ error: "Tanımsız varsayılan rol" });
      if (cfg.NODE_ENV === "production") {
        if (!v.url.startsWith("ldaps://"))
          return res.status(400).json({ error: "Üretimde yalnızca ldaps:// bağlantısı kabul edilir" });
        if (!v.tlsVerify)
          return res.status(400).json({ error: "Üretimde TLS sertifika doğrulaması kapatılamaz" });
      }
      const view = await dirconfig.save(v, req.user.username, cfg);
      await audit.record("dizin.ayarlari", req.user.username, {
        detail: { url: v.url, baseDn: v.baseDn, bindDn: v.bindDn, tls: v.tlsVerify,
                  aktif: v.active, otomatik_kullanici: v.autoCreateUsers,
                  parola_degisti: typeof v.bindPassword === "string" && v.bindPassword.length > 0 },
      });
      res.json({ settings: view });
    } catch (e) { next(e); }
  });

  r.post("/directory/verify", requireScreen("m.dir", "write"), async (req, res, next) => {
    try {
      const out = await ldap.verify(await dirconfig.effective(cfg));
      await dirconfig.recordTest(out.ok, out.error, null);
      await audit.record("dizin.baglanti_denemesi", req.user.username, { ok: out.ok, detail: { url: out.url, hata: out.error || null } });
      res.status(out.ok ? 200 : 502).json(out);
    } catch (e) { next(e); }
  });

  /* Belirli bir kullanıcının dizinde bulunup bulunmadığını sınar; parola istenmez. */
  r.post("/directory/lookup", requireScreen("m.dir", "write"), async (req, res, next) => {
    try {
      const username = z.string().trim().regex(/^[A-Za-z0-9._-]{2,64}$/).parse(req.body.username);
      const out = await ldap.lookup(username, await dirconfig.effective(cfg));
      await dirconfig.recordTest(out.ok, out.error, username);
      await audit.record("dizin.kullanici_sorgusu", req.user.username, { ok: out.ok, detail: { sorgulanan: username } });
      res.status(out.ok ? 200 : 404).json(out);
    } catch (e) { next(e); }
  });

  /* ---- kısayollar ---- */
  r.get("/shortcuts", requireScreen("m.short"), async (req, res) => {
    res.json({ items: await db.many("SELECT * FROM shortcuts ORDER BY sort, id") });
  });

  r.post("/shortcuts", requireScreen("m.short", "write"), async (req, res, next) => {
    try {
      const v = z.object({
        name: z.string().trim().min(2).max(80),
        url: z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "http veya https olmalı"),
        active: z.boolean().default(true),
      }).parse(req.body);
      await db.query("INSERT INTO shortcuts (name, url, active) VALUES ($1,$2,$3)", [v.name, v.url, v.active]);
      await audit.record("kisayol.eklendi", req.user.username, { detail: { ad: v.name } });
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  /* ---- e-posta ayarları ---- */
  const mailconfig = require("../lib/mailconfig");
  const mailer = require("../lib/mailer");

  r.get("/mail", requireScreen("m.mail"), async (req, res, next) => {
    try {
      const view = await mailconfig.forDisplay(cfg);
      const q = await db.one(
        `SELECT COUNT(*)::int AS pending,
                COUNT(error)::int AS failed
           FROM mail_outbox WHERE sent_at IS NULL`);
      res.json({ settings: view, queue: q || { pending: 0, failed: 0 } });
    } catch (e) { next(e); }
  });

  const mailSchema = z.object({
    host: z.string().trim().max(255).regex(/^[a-zA-Z0-9._-]*$/, "Sunucu adı yalnızca harf, rakam, nokta ve tire içerebilir"),
    port: z.coerce.number().int().min(1).max(65535),
    encryption: z.enum(["none", "starttls", "tls"]),
    authUser: z.string().trim().max(255).optional().nullable(),
    /* Boş bırakılırsa kayıtlı parola korunur; "" gönderilirse silinir. */
    password: z.string().max(255).optional(),
    fromAddress: z.string().trim().email("Gönderen adresi geçerli bir e-posta olmalı"),
    replyTo: z.union([z.string().trim().email(), z.literal("")]).optional().nullable(),
    mailDomain: z.string().trim().regex(/^[a-zA-Z0-9.-]+$/).max(255),
    groupInspection: z.string().trim().email(),
    groupAll: z.string().trim().email(),
    active: z.boolean().default(false),
  });

  r.put("/mail", requireScreen("m.mail", "write"), async (req, res, next) => {
    try {
      const v = mailSchema.parse(req.body);
      if (v.active && !v.host) return res.status(400).json({ error: "Etkinleştirmek için SMTP sunucusu zorunlu" });
      if (v.encryption === "none" && cfg.NODE_ENV === "production" && v.authUser)
        return res.status(400).json({ error: "Kimlik doğrulamalı gönderimde şifreleme kapatılamaz" });
      const view = await mailconfig.save(v, req.user.username, cfg);
      /* Parola denetim kaydına yazılmaz; yalnızca değişip değişmediği belirtilir. */
      await audit.record("eposta.ayarlari", req.user.username, {
        detail: { host: v.host, port: v.port, sifreleme: v.encryption, aktif: v.active,
                  kimlik: v.authUser || null, parola_degisti: typeof v.password === "string" && v.password.length > 0 },
      });
      res.json({ settings: view });
    } catch (e) { next(e); }
  });

  /* Bağlantı denemesi: TLS ve kimlik doğrulama sınanır, posta gönderilmez. */
  r.post("/mail/verify", requireScreen("m.mail", "write"), async (req, res, next) => {
    try {
      const out = await mailer.verify(cfg);
      await audit.record("eposta.baglanti_denemesi", req.user.username, { ok: out.ok, detail: { host: out.host, hata: out.error || null } });
      res.status(out.ok ? 200 : 502).json(out);
    } catch (e) { next(e); }
  });

  /* Deneme e-postası yalnızca isteği yapan yöneticinin adresine gider. */
  r.post("/mail/test", requireScreen("m.mail", "write"), async (req, res, next) => {
    try {
      const eff = await mailconfig.effective(cfg);
      const to = req.user.email || `${req.user.username}@${eff.mailDomain}`;
      const out = await mailer.sendTest(cfg, to);
      await audit.record("eposta.deneme_gonderimi", req.user.username, { ok: out.ok, detail: { alici: to, hata: out.error || null } });
      res.status(out.ok ? 200 : 502).json(out);
    } catch (e) { next(e); }
  });

  /* Kuyruğu elle boşaltma (cron dışında). */
  r.post("/mail/flush", requireScreen("m.mail", "write"), async (req, res, next) => {
    try {
      const out = await mailer.flush(cfg, 100);
      await audit.record("eposta.kuyruk_bosaltildi", req.user.username, { detail: out });
      res.json(out);
    } catch (e) { next(e); }
  });

  /* ---- denetim kaydı doğrulaması (yalnızca Teftiş/İç Kontrol ekranı) ---- */
  r.get("/audit/verify", requireScreen("c.audit"), async (req, res) => {
    res.json(await audit.verify());
  });

  return r;
};
