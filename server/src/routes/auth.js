"use strict";
const express = require("express");
const { query } = require("../db");
const { config } = require("../config");
const { createSession, destroySession } = require("../auth/session");
const { verifyAgainstDirectory } = require("../auth/ldap");
const { audit } = require("../lib/audit");

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

// directory_settings.active=true ise AD/LDAP, değilse (veya satır yoksa)
// .env'deki AUTH_MODE'a düşülür — Admin Panel > Dizin Ayarları'ndaki "AD
// kullan" anahtarı buradan okunur, DB'den dinamik; sunucu yeniden
// başlatılmasına gerek yoktur.
async function getEffectiveAuthMode() {
  try {
    const { rows } = await query("SELECT active FROM directory_settings WHERE id=1");
    if (rows.length) return rows[0].active ? "ldap" : "mock";
  } catch (e) { /* tablo yoksa (eski migration) .env'e düş */ }
  return config.authMode;
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

    const authMode = await getEffectiveAuthMode();
    if (authMode === "ldap") {
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

    const session = await createSession(uname);
    setSessionCookie(res, session);
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
