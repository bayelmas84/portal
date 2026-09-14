"use strict";
const express = require("express");
const { query } = require("../db");
const { requireRead, requireWrite } = require("../middleware/auth");
const { encryptSecret } = require("../lib/crypto");
const { testDirectoryConnection } = require("../auth/ldap");
const { getSmtpSettings, saveSmtpSettings, setSmtpActive, testSmtpConnection } = require("../lib/mailer");
const {
  getAllAccess, setAccess, resetAccessToDefault,
  getAllAvailability, setAvailability, DEFAULT_ACCESS,
} = require("../lib/permissions");
const { audit } = require("../lib/audit");
const { config } = require("../config");

const router = express.Router();

router.get("/users", requireRead("m.users"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT username, name, email, role, unit, title, manager_username, active FROM users ORDER BY name"
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

const VALID_ROLES = Object.keys(DEFAULT_ACCESS).concat(["gmy", "opsdir"]).filter((v, i, a) => a.indexOf(v) === i);

router.post("/users", requireWrite("m.users"), async (req, res, next) => {
  try {
    const { username, name, email, role, unit, title, managerUsername } = req.body || {};
    if (!username || !/^[a-z]+\.[a-z]+$/.test(username)) {
      return res.status(400).json({ error: "Kullanıcı adı 'ad.soyad' biçiminde olmalı." });
    }
    if (!name || !email || !role) return res.status(400).json({ error: "Ad, e-posta ve rol zorunlu." });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: "Geçersiz rol." });
    const { rows } = await query(
      `INSERT INTO users (username,name,email,role,unit,title,manager_username)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING username,name,email,role,unit,title,manager_username,active`,
      [username, name, email, role, unit || null, title || null, managerUsername || null]
    );
    await audit(`Kullanıcı oluşturuldu: ${username} (${role})`, req.user.username);
    res.status(201).json({ item: rows[0] });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Bu kullanıcı adı zaten var." });
    next(e);
  }
});

router.put("/users/:username", requireWrite("m.users"), async (req, res, next) => {
  try {
    const { name, email, role, unit, title, managerUsername, active } = req.body || {};
    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: "Geçersiz rol." });
    if (req.params.username === req.user.username && role && role !== req.user.role) {
      return res.status(409).json({ error: "Kendi rolünüzü değiştiremezsiniz." });
    }
    const { rows } = await query(
      `UPDATE users SET
         name=COALESCE($1,name), email=COALESCE($2,email), role=COALESCE($3,role),
         unit=COALESCE($4,unit), title=COALESCE($5,title),
         manager_username=COALESCE($6,manager_username), active=COALESCE($7,active)
       WHERE username=$8
       RETURNING username,name,email,role,unit,title,manager_username,active`,
      [name, email, role, unit, title, managerUsername, active, req.params.username]
    );
    if (!rows.length) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    await audit(`Kullanıcı güncellendi: ${req.params.username}`, req.user.username);
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

// ------------------------------ Dizin (AD) ----------------------------------
router.get("/directory", requireRead("m.dir"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT id,url,base_dn,bind_dn,user_filter,tls,default_role,active,last_test_at,last_test_ok,last_test_msg,updated_by,updated_at, (bind_password_encrypted IS NOT NULL) AS password_set FROM directory_settings WHERE id=1"
    );
    res.json({ item: rows[0] });
  } catch (e) { next(e); }
});

router.put("/directory", requireWrite("m.dir"), async (req, res, next) => {
  try {
    const { url, baseDn, bindDn, bindPassword, userFilter, tls, defaultRole, active } = req.body || {};
    if (!/^ldaps?:\/\/[A-Za-z0-9._-]+(:\d{1,5})?$/.test(String(url || "").trim())) {
      return res.status(400).json({ error: "Sunucu adresi ldaps://sunucu:636 biçiminde olmalı." });
    }
    if (!baseDn || baseDn.trim().length < 3) return res.status(400).json({ error: "Base DN zorunlu." });
    if (!bindDn || bindDn.trim().length < 3) return res.status(400).json({ error: "Servis hesabı DN zorunlu." });
    if (!String(userFilter || "").includes("{username}")) return res.status(400).json({ error: "Kullanıcı filtresi {username} içermeli." });

    const current = await query("SELECT bind_password_encrypted FROM directory_settings WHERE id=1");
    if (active && !current.rows[0].bind_password_encrypted && !bindPassword) {
      return res.status(400).json({ error: "Etkinleştirmek için servis hesabı parolası gerekli." });
    }
    const passwordEncrypted = bindPassword ? encryptSecret(bindPassword) : current.rows[0].bind_password_encrypted;
    await query(
      `UPDATE directory_settings SET url=$1, base_dn=$2, bind_dn=$3, bind_password_encrypted=$4,
         user_filter=$5, tls=$6, default_role=$7, active=$8, updated_by=$9, updated_at=now() WHERE id=1`,
      [url.trim(), baseDn.trim(), bindDn.trim(), passwordEncrypted, userFilter.trim(), !!tls, defaultRole || "staff", !!active, req.user.username]
    );
    await audit(`Dizin ayarları güncellendi (parola ${bindPassword ? "değişti" : "korundu"})`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/directory/test", requireWrite("m.dir"), async (req, res, next) => {
  try {
    const result = await testDirectoryConnection();
    await query(
      "UPDATE directory_settings SET last_test_at=now(), last_test_ok=$1, last_test_msg=$2 WHERE id=1",
      [result.ok, result.msg]
    );
    await audit(`Dizin bağlantı denemesi: ${result.ok ? "başarılı" : "başarısız"}`, req.user.username, result.ok);
    res.json(result);
  } catch (e) { next(e); }
});

// --------------------------------- SMTP -------------------------------------
router.get("/smtp", requireRead("m.smtp"), async (req, res, next) => {
  try {
    const s = await getSmtpSettings();
    const { password_encrypted, ...safe } = s; // eslint-disable-line no-unused-vars
    res.json({ item: { ...safe, passwordSet: !!password_encrypted } });
  } catch (e) { next(e); }
});

router.put("/smtp", requireWrite("m.smtp"), async (req, res, next) => {
  try {
    const { host, port, fromAddr, username, password, tls } = req.body || {};
    if (!host) return res.status(400).json({ error: "Sunucu adresi zorunlu." });
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return res.status(400).json({ error: "Port 1-65535 arasında olmalı." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(fromAddr || ""))) return res.status(400).json({ error: "Geçerli bir gönderen adresi girin." });
    await saveSmtpSettings({ host, port: p, fromAddr, username: username || "", password, tls: !!tls, updatedBy: req.user.username });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/smtp/active", requireWrite("m.smtp"), async (req, res, next) => {
  try {
    await setSmtpActive(!!req.body.active, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/smtp/test", requireWrite("m.smtp"), async (req, res, next) => {
  try {
    const result = await testSmtpConnection();
    await audit(`SMTP bağlantı denemesi: ${result.ok ? "başarılı" : "başarısız"}`, req.user.username, result.ok);
    res.json(result);
  } catch (e) { next(e); }
});

// -------------------------------- Marka -------------------------------------
router.get("/brand", requireRead("m.brand"), async (req, res, next) => {
  try {
    const { rows } = await query("SELECT key, value FROM brand_settings");
    const map = {};
    rows.forEach((r) => { map[r.key] = r.value; });
    res.json({ item: map });
  } catch (e) { next(e); }
});

router.put("/brand", requireWrite("m.brand"), async (req, res, next) => {
  try {
    const allowed = ["company", "companyShort", "product", "slogan", "loginTitle", "loginHint", "footer", "accent"];
    const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
    for (const [k, v] of entries) {
      await query(
        "INSERT INTO brand_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2",
        [k, String(v)]
      );
    }
    await audit(`Marka ve metinler güncellendi: ${entries.map(([k]) => k).join(", ") || "değişiklik yok"}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Not: "imza" (powered by bayelmas) kasıtlı olarak bu API'de yoktur — sabittir,
// istemci tarafında hardcode edilir, hiçbir admin ucundan değiştirilemez.

// --------------------------- Ekran yetkileri (m.access) ---------------------
router.get("/access", requireRead("m.access"), async (req, res, next) => {
  try {
    res.json({ items: await getAllAccess() });
  } catch (e) { next(e); }
});

router.put("/access", requireWrite("m.access"), async (req, res, next) => {
  try {
    const { role, screenKey, level } = req.body || {};
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: "Geçersiz rol." });
    if (!["none", "read", "write"].includes(level)) return res.status(400).json({ error: "Geçersiz seviye." });
    // Admin'in kendi admin panel erişimini kaldırması kilitlenmeye yol açar; engellenir.
    if (role === "admin" && ["m.access", "m.avail"].includes(screenKey) && level === "none") {
      return res.status(409).json({ error: "Admin rolünün bu ekranlara erişimi kaldırılamaz (kilitlenme riski)." });
    }
    await setAccess(role, screenKey, level);
    await audit(`Ekran yetkisi değişti: ${role} / ${screenKey} -> ${level}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/access/reset", requireWrite("m.access"), async (req, res, next) => {
  try {
    await resetAccessToDefault();
    await audit("Ekran yetkileri varsayılana döndürüldü", req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// --------------------------- Ekran yönetimi (m.avail) ------------------------
router.get("/availability", requireRead("m.avail"), async (req, res, next) => {
  try {
    res.json({ items: await getAllAvailability() });
  } catch (e) { next(e); }
});

router.put("/availability", requireWrite("m.avail"), async (req, res, next) => {
  try {
    const { screenKey, status } = req.body || {};
    if (["admin", "m.avail", "m.access"].includes(screenKey) && status !== "acik") {
      return res.status(409).json({ error: "Admin Panel ve bu iki ekran kapatılamaz (kilitlenme riski)." });
    }
    await setAvailability(screenKey, status);
    await audit(`Ekran durumu değişti: ${screenKey} -> ${status}`, req.user.username);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
