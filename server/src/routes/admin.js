"use strict";
const express = require("express");
const { query } = require("../db");
const { requireRead, requireWrite, requireAuth } = require("../middleware/auth");
const { testDirectoryConnection } = require("../auth/ldap");
const { getSmtpSettings, testSmtpConnection } = require("../lib/mailer");
const {
  getAllAccess, DEFAULT_ACCESS,
  getAllAvailability,
} = require("../lib/permissions");
const { audit } = require("../lib/audit");

const router = express.Router();

// KURAL: Admin panelinde yapılan HER yazma işlemi, işlemi yapan adminin
// yöneticisi tarafından onaylanmadan uygulanmaz. Bu fonksiyon doğrulamadan
// SONRA çağrılır; gerçek veritabanı değişikliği yalnızca onaylanınca
// (announcements.js -> decide -> applyAdminAction) gerçekleşir.
async function requestAdminApproval(req, res, targetType, payload, subject) {
  if (!req.user.manager_username) {
    return res.status(409).json({ error: "Yöneticiniz tanımlı değil, bu işlem onaya gönderilemiyor." });
  }
  await query(
    `INSERT INTO approval_requests (kind, subject, category, target_type, requested_by, approver, reason, payload, step, total_steps)
     VALUES ('admin.action',$1,'Genel',$2,$3,$4,$5,$6,1,1)`,
    [subject, targetType, req.user.username, req.user.manager_username, subject, JSON.stringify(payload)]
  );
  await audit(`Admin işlemi onaya gönderildi: ${subject}`, req.user.username, true,
    { actionType: "diğer", approvers: [req.user.manager_username] });
  res.status(202).json({ ok: true, pending: true, message: "Onaya gönderildi (onaycı: yöneticiniz)." });
}

router.get("/users", requireRead("m.users"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT username, name, email, role, unit, title, manager_username, active FROM users ORDER BY name"
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// ------------------------------- Birimler (units) ---------------------------
// Herkese okuma açıktır: kullanıcı formu birim seçilince yöneticiyi göstermek
// için buna ihtiyaç duyar (hassas bilgi değildir).
router.get("/units", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.code, u.name, u.active, u.manager_username, m.name AS manager_name
       FROM units u LEFT JOIN users m ON m.username = u.manager_username ORDER BY u.name`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/units", requireWrite("m.units"), async (req, res, next) => {
  try {
    const { code, name, managerUsername } = req.body || {};
    if (!code || !/^[A-ZÇĞİÖŞÜ0-9]{2,8}$/.test(code)) return res.status(400).json({ error: "Birim kodu 2-8 büyük harf/rakam olmalı." });
    if (!name || !name.trim()) return res.status(400).json({ error: "Birim adı zorunlu." });
    if (!managerUsername) return res.status(400).json({ error: "Her birime bir yönetici atanmalı." });
    const mgr = await query("SELECT 1 FROM users WHERE username=$1 AND active", [managerUsername]);
    if (!mgr.rowCount) return res.status(400).json({ error: "Seçilen yönetici bulunamadı veya pasif." });
    await requestAdminApproval(req, res, "admin.unit.create", { code, name, managerUsername },
      `Yeni birim: ${code} — ${name.trim()}`);
  } catch (e) { next(e); }
});

router.put("/units/:code", requireWrite("m.units"), async (req, res, next) => {
  try {
    const { name, managerUsername, active } = req.body || {};
    const existing = await query("SELECT 1 FROM units WHERE code=$1", [req.params.code]);
    if (!existing.rowCount) return res.status(404).json({ error: "Birim bulunamadı." });
    if (managerUsername !== undefined) {
      if (!managerUsername) return res.status(400).json({ error: "Her birime bir yönetici atanmalı — boş bırakılamaz." });
      const mgr = await query("SELECT 1 FROM users WHERE username=$1 AND active", [managerUsername]);
      if (!mgr.rowCount) return res.status(400).json({ error: "Seçilen yönetici bulunamadı veya pasif." });
    }
    await requestAdminApproval(req, res, "admin.unit.update", { code: req.params.code, name, managerUsername, active },
      `Birim güncelleme: ${req.params.code}`);
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
    const existing = await query("SELECT 1 FROM users WHERE username=$1", [username]);
    if (existing.rowCount) return res.status(409).json({ error: "Bu kullanıcı adı zaten var." });
    await requestAdminApproval(req, res, "admin.user.create",
      { username, name, email, role, unit, title, managerUsername },
      `Yeni kullanıcı: ${username} (${role})`);
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
    const existing = await query("SELECT 1 FROM users WHERE username=$1", [req.params.username]);
    if (!existing.rowCount) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    await requestAdminApproval(req, res, "admin.user.update",
      { username: req.params.username, name, email, role, unit, title, managerUsername, active },
      `Kullanıcı güncelleme: ${req.params.username}`);
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
    // GÜVENLİK: yalnızca şifreli LDAPS kabul edilir; düz ldap:// (şifresiz) reddedilir.
    if (!/^ldaps:\/\/[A-Za-z0-9._-]+(:\d{1,5})?$/.test(String(url || "").trim())) {
      return res.status(400).json({ error: "Sunucu adresi ldaps://sunucu:636 biçiminde olmalı (şifresiz ldap:// kabul edilmez)." });
    }
    if (!baseDn || baseDn.trim().length < 3) return res.status(400).json({ error: "Base DN zorunlu." });
    if (!bindDn || bindDn.trim().length < 3) return res.status(400).json({ error: "Servis hesabı DN zorunlu." });
    if (!String(userFilter || "").includes("{username}")) return res.status(400).json({ error: "Kullanıcı filtresi {username} içermeli." });

    const current = await query("SELECT bind_password_encrypted FROM directory_settings WHERE id=1");
    if (active && !current.rows[0].bind_password_encrypted && !bindPassword) {
      return res.status(400).json({ error: "Etkinleştirmek için servis hesabı parolası gerekli." });
    }
    await requestAdminApproval(req, res, "admin.directory",
      { url, baseDn, bindDn, bindPassword, userFilter, tls, defaultRole, active },
      "Dizin (AD) ayarları güncelleme");
  } catch (e) { next(e); }
});

// Bağlantı denemesi bir yazma işlemi değildir (yalnızca test kaydı düşer), onay gerekmez.
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
    await requestAdminApproval(req, res, "admin.smtp",
      { host, port: p, fromAddr, username, password, tls },
      "SMTP ayarları güncelleme");
  } catch (e) { next(e); }
});

router.post("/smtp/active", requireWrite("m.smtp"), async (req, res, next) => {
  try {
    await requestAdminApproval(req, res, "admin.smtp.active",
      { active: !!req.body.active },
      `SMTP ${req.body.active ? "etkinleştirme" : "devre dışı bırakma"}`);
  } catch (e) { next(e); }
});

// Bağlantı denemesi bir yazma işlemi değildir, onay gerekmez.
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
    await requestAdminApproval(req, res, "admin.brand", req.body || {},
      `Marka ve metinler güncelleme: ${entries.map(([k]) => k).join(", ") || "değişiklik yok"}`);
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
    if (role === "admin" && ["m.access", "m.avail"].includes(screenKey) && level === "none") {
      return res.status(409).json({ error: "Admin rolünün bu ekranlara erişimi kaldırılamaz (kilitlenme riski)." });
    }
    await requestAdminApproval(req, res, "admin.access", { role, screenKey, level },
      `Ekran yetkisi değişikliği: ${role} / ${screenKey} -> ${level}`);
  } catch (e) { next(e); }
});

router.post("/access/reset", requireWrite("m.access"), async (req, res, next) => {
  try {
    await requestAdminApproval(req, res, "admin.access.reset", {}, "Ekran yetkilerini varsayılana döndürme");
  } catch (e) { next(e); }
});

// --------------------------- Ekran yönetimi (m.avail) ------------------------
// Herhangi bir ekranın acik/bakimda/kapali oldugunu bilmek gezinme icin gereklidir
// ve hassas bilgi degildir; bu yuzden m.avail yazma yetkisi olmayan herkes de
// (yalnizca oturum acik olmali) gorebilir.
router.get("/availability", requireAuth, async (req, res, next) => {
  try {
    res.json({ items: await getAllAvailability() });
  } catch (e) { next(e); }
});

router.put("/availability", requireWrite("m.avail"), async (req, res, next) => {
  try {
    const { screenKey, status } = req.body || {};
    // Kilitlenme koruması: Admin Panel, ekran yönetimi/yetkileri VE onay kutusu asla
    // kapatılamaz. Aksi halde admin işlemleri onaya gitmeye devam ederken kimse bu
    // onayları görüp verecek bir ekrana erişemez hale gelir (sistem kilitlenir).
    if (["admin", "m.avail", "m.access", "approvals", "p.in", "p.my", "p.done"].includes(screenKey) && status !== "acik") {
      return res.status(409).json({ error: "Admin Panel ve bu iki ekran kapatılamaz (kilitlenme riski)." });
    }
    await requestAdminApproval(req, res, "admin.availability", { screenKey, status },
      `Ekran durumu değişikliği: ${screenKey} -> ${status}`);
  } catch (e) { next(e); }
});

// Toplu ekran durumu değişikliği (ör. "Tümünü aç", "Varsayılana dön"): onlarca ayrı
// onay talebi açmak yerine TEK bir talep, tüm hedefleri payload'da taşır.
router.post("/availability/bulk", requireWrite("m.avail"), async (req, res, next) => {
  try {
    const { targets } = req.body || {};
    if (!targets || typeof targets !== "object") return res.status(400).json({ error: "targets bir harita olmalı." });
    const locked = ["admin", "m.avail", "m.access", "approvals", "p.in", "p.my", "p.done"];
    for (const [key, status] of Object.entries(targets)) {
      if (locked.includes(key) && status !== "acik") {
        return res.status(409).json({ error: `${key} kapatılamaz (kilitlenme riski).` });
      }
    }
    await requestAdminApproval(req, res, "admin.availability.bulk", { targets },
      `Toplu ekran durumu değişikliği (${Object.keys(targets).length} ekran)`);
  } catch (e) { next(e); }
});

module.exports = router;
