"use strict";
const express = require("express");
const { query } = require("../db");
const { requireRead, requireWrite } = require("../middleware/auth");
const { encryptSecret } = require("../lib/crypto");
const { testDirectoryConnection } = require("../auth/ldap");
const { getSmtpSettings, saveSmtpSettings, setSmtpActive, testSmtpConnection } = require("../lib/mailer");
const { audit } = require("../lib/audit");

const router = express.Router();

router.get("/users", requireRead("m.users"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT username, name, email, role, unit, title, manager_username, active FROM users ORDER BY name"
    );
    res.json({ items: rows });
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

module.exports = router;
