"use strict";
const { getSession } = require("../auth/session");
const { query } = require("../db");
const { canRead, canWrite } = require("../lib/permissions");
const { config } = require("../config");

async function attachUser(req, res, next) {
  try {
    const sid = req.cookies[config.session.cookieName];
    const session = await getSession(sid);
    if (!session) {
      req.user = null;
      return next();
    }
    req.session = session;
    // 2FA bekleyen bir oturum HİÇBİR korumalı uca erişemez — yalnızca
    // /api/auth/2fa/verify ucu bu ara durumdaki oturumu (req.session üzerinden,
    // req.user'a bakmadan) tanır.
    if (session.pending_2fa) {
      req.user = null;
      return next();
    }
    const { rows } = await query(
      "SELECT username, name, email, role, unit, title, manager_username, color FROM users WHERE username=$1 AND active",
      [session.username]
    );
    req.user = rows[0] || null;
    // Admin/Teftiş gibi 2FA'nın ZORUNLU olduğu bir rolde, kullanıcı henüz
    // 2FA kurmadıysa oturum "kurulum bekliyor" durumundadır: req.user set
    // edilir (kurulum uçlarının kimliğe ihtiyacı var) ama app.js'deki
    // blockIfMustSetup2FA middleware'i 2FA uçları dışında her isteği keser.
    req.mustSetupTwoFactor = !!session.must_setup_2fa;
    next();
  } catch (e) {
    next(e);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Oturum açmanız gerekiyor." });
  next();
}

function requireRead(screenKey) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Oturum açmanız gerekiyor." });
      if (!(await canRead(req.user.role, screenKey))) {
        return res.status(403).json({ error: "Bu ekrana erişim yetkiniz yok." });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

function requireWrite(screenKey) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: "Oturum açmanız gerekiyor." });
      if (!(await canWrite(req.user.role, screenKey))) {
        return res.status(403).json({ error: "Bu işlem için yetkiniz yok." });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

// Çift-gönderim (double-submit) CSRF: giriş dışındaki tüm durum-değiştiren
// isteklerde X-CSRF-Token başlığı, oturumun csrf_secret değeriyle eşleşmelidir.
// Giriş ucu (/api/auth/login) hariçtir — henüz oturum/CSRF token'ı yoktur.
function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.path === "/api/auth/login") return next();
  if (req.path === "/api/auth/2fa/verify") return next(); // henüz csrfToken alınmadı
  if (req.path === "/api/auth/2fa/send-email-code") return next(); // henüz csrfToken alınmadı
  if (req.path === "/api/auth/2fa/enable-email/request") return next(); // must_setup_2fa: henüz csrfToken yok
  if (req.path === "/api/auth/2fa/enable-email/confirm") return next(); // must_setup_2fa: henüz csrfToken yok
  const header = req.get("X-CSRF-Token");
  if (!req.session || !header || header !== req.session.csrf_secret) {
    return res.status(403).json({ error: "CSRF doğrulaması başarısız." });
  }
  next();
}

// Admin/Teftiş gibi 2FA'nın zorunlu olduğu rollerde, kullanıcı henüz kurulum
// yapmadıysa TÜM istekleri (2FA kurulum/oturum uçları hariç) keser.
const ALLOWED_DURING_SETUP = [
  "/api/auth/logout", "/api/auth/me", "/api/auth/2fa/status",
  "/api/auth/2fa/setup", "/api/auth/2fa/enable",
  "/api/auth/2fa/enable-email/request", "/api/auth/2fa/enable-email/confirm",
];
function blockIfMustSetup2FA(req, res, next) {
  if (req.mustSetupTwoFactor && !ALLOWED_DURING_SETUP.includes(req.path)) {
    return res.status(403).json({ error: "Rolünüz için iki faktörlü kimlik doğrulama zorunludur. Devam etmeden önce kurulumu tamamlayın.", mustSetupTwoFactor: true });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireRead, requireWrite, requireCsrf, blockIfMustSetup2FA };
