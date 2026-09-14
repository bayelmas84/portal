"use strict";
const express = require("express");
const { query } = require("../db");
const { config } = require("../config");
const { requireAuth } = require("../middleware/auth");
const { createSession, destroySession, completeTwoFactor } = require("../auth/session");
const { verifyAgainstDirectory } = require("../auth/ldap");
const { audit } = require("../lib/audit");
const { encryptSecret, decryptSecret } = require("../lib/crypto");
const { generateSecret, verifyToken, otpauthUri } = require("../lib/totp");

const router = express.Router();

function setSessionCookie(res, session) {
  res.cookie(config.session.cookieName, session.id, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    expires: session.absoluteExpiresAt,
  });
}

router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Kullanıcı adı gerekli." });
    }
    const uname = username.trim().toLowerCase();
    const { rows } = await query("SELECT * FROM users WHERE username=$1 AND active", [uname]);
    const user = rows[0];
    if (!user) {
      await audit(`Başarısız giriş denemesi: ${uname}`, uname, false);
      return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
    }

    if (config.authMode === "ldap") {
      if (!password) return res.status(400).json({ error: "Parola gerekli." });
      let ok;
      try {
        ok = await verifyAgainstDirectory(uname, password);
      } catch (e) {
        return res.status(503).json({ error: "Dizin sunucusuna ulaşılamadı: " + e.message });
      }
      if (!ok) {
        await audit(`Başarısız giriş denemesi: ${uname}`, uname, false);
        return res.status(401).json({ error: "Kullanıcı adı veya parola hatalı." });
      }
    }
    // authMode === 'mock': yalnızca geliştirme/test — kullanıcı adı yeterli.
    // config.js, NODE_ENV=production'da AUTH_MODE!=ldap olduğunda uyarı basar.

    const session = await createSession(uname, !!user.totp_enabled);
    setSessionCookie(res, session);
    if (user.totp_enabled) {
      await audit(`Giriş (1/2 — şifre doğrulandı, 2FA kodu bekleniyor): ${uname}`, uname, true);
      return res.json({ needsTwoFactor: true });
    }
    await audit(`Giriş yapıldı: ${uname}`, uname, true);
    res.json({
      user: {
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        unit: user.unit,
        title: user.title,
        color: user.color,
        managerUsername: user.manager_username,
      },
      csrfToken: session.csrfSecret,
    });
  } catch (e) {
    next(e);
  }
});

// 2. adım: şifre doğrulandıktan sonra bekleyen oturuma karşı 6 haneli TOTP
// kodunu doğrular. req.user burada HENÜZ set değildir (attachUser, pending_2fa
// oturumları için req.user=null yapar) — bu yüzden req.session üzerinden gideriz.
router.post("/2fa/verify", async (req, res, next) => {
  try {
    if (!req.session || !req.session.pending_2fa) {
      return res.status(400).json({ error: "Doğrulanacak bekleyen bir 2FA oturumu yok." });
    }
    const { code } = req.body || {};
    const { rows } = await query("SELECT * FROM users WHERE username=$1 AND active", [req.session.username]);
    const user = rows[0];
    if (!user || !user.totp_enabled || !user.totp_secret_encrypted) {
      return res.status(409).json({ error: "Bu hesapta 2FA etkin değil." });
    }
    const secret = decryptSecret(user.totp_secret_encrypted);
    if (!verifyToken(secret, code)) {
      await audit(`2FA kodu hatalı: ${user.username}`, user.username, false);
      return res.status(401).json({ error: "Kod hatalı veya süresi geçmiş." });
    }
    await completeTwoFactor(req.session.id);
    await audit(`Giriş tamamlandı (2/2 — 2FA doğrulandı): ${user.username}`, user.username, true);
    res.json({
      user: {
        username: user.username, name: user.name, email: user.email, role: user.role,
        unit: user.unit, title: user.title, color: user.color, managerUsername: user.manager_username,
      },
      csrfToken: req.session.csrf_secret,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const sid = req.cookies[config.session.cookieName];
    if (sid) await destroySession(sid);
    res.clearCookie(config.session.cookieName, { path: "/" });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.get("/me", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Oturum açık değil." });
  res.json({ user: req.user, csrfToken: req.session.csrf_secret });
});

// Kendi rolünüzün ekran yetki haritası: arayüzün hangi düğmeleri göstereceğine
// karar verebilmesi için gerekir (m.access ile ilgisi yok, m.access yetkisi
// gerektirmez — herkes yalnızca KENDİ rolünün haritasını görür).
// ------------------------------- 2FA kurulumu --------------------------------
// Herkes kendi hesabı için açabilir/kapatabilir (admin onayı GEREKMEZ — kendi
// güvenliğinizi güçlendirmek bir admin işlemi değildir). Adım 1: setup (secret
// üret, henüz aktifleştirme), Adım 2: enable (ilk kodu doğrulayıp aktifleştir).
router.post("/2fa/setup", requireAuth, async (req, res, next) => {
  try {
    const secret = generateSecret();
    await query("UPDATE users SET totp_secret_encrypted=$1, totp_enabled=false WHERE username=$2",
      [encryptSecret(secret), req.user.username]);
    res.json({ secret, otpauthUri: otpauthUri(secret, req.user.username, "Tera Portal") });
  } catch (e) { next(e); }
});

router.post("/2fa/enable", requireAuth, async (req, res, next) => {
  try {
    const { code } = req.body || {};
    const { rows } = await query("SELECT totp_secret_encrypted FROM users WHERE username=$1", [req.user.username]);
    const enc = rows[0] && rows[0].totp_secret_encrypted;
    if (!enc) return res.status(409).json({ error: "Önce /2fa/setup ile bir secret üretin." });
    if (!verifyToken(decryptSecret(enc), code)) return res.status(401).json({ error: "Kod hatalı veya süresi geçmiş." });
    await query("UPDATE users SET totp_enabled=true WHERE username=$1", [req.user.username]);
    await audit(`2FA etkinleştirildi: ${req.user.username}`, req.user.username, true);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/2fa/disable", requireAuth, async (req, res, next) => {
  try {
    await query("UPDATE users SET totp_enabled=false, totp_secret_encrypted=NULL WHERE username=$1", [req.user.username]);
    await audit(`2FA devre dışı bırakıldı: ${req.user.username}`, req.user.username, true);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.get("/2fa/status", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT totp_enabled FROM users WHERE username=$1", [req.user.username]);
    res.json({ enabled: !!(rows[0] && rows[0].totp_enabled) });
  } catch (e) { next(e); }
});

router.get("/my-access", async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Oturum açık değil." });
    const { rows } = await query("SELECT screen_key, level FROM role_access WHERE role=$1", [req.user.role]);
    const map = {};
    rows.forEach((r) => { map[r.screen_key] = r.level; });
    res.json({ role: req.user.role, access: map });
  } catch (e) { next(e); }
});

module.exports = router;
