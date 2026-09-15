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
    const { rows } = await query(
      "SELECT username, name, email, role, unit, title, manager_username, color FROM users WHERE username=$1 AND active",
      [session.username]
    );
    req.user = rows[0] || null;
    req.forcePasswordChange = !!session.force_password_change;
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
  const header = req.get("X-CSRF-Token");
  if (!req.session || !header || header !== req.session.csrf_secret) {
    return res.status(403).json({ error: "CSRF doğrulaması başarısız." });
  }
  next();
}

// Şifre değişikliği zorunlu olan bir oturum, bunu tamamlayana kadar (ya da
// çıkış yapana kadar) başka hiçbir uca erişemez.
const ALLOWED_DURING_PASSWORD_CHANGE = ["/api/auth/logout", "/api/auth/me", "/api/auth/change-password"];
function blockIfForcePasswordChange(req, res, next) {
  if (req.forcePasswordChange && !ALLOWED_DURING_PASSWORD_CHANGE.includes(req.path)) {
    return res.status(403).json({ error: "Devam etmeden önce şifrenizi değiştirmeniz gerekiyor.", mustChangePassword: true });
  }
  next();
}

module.exports = { attachUser, requireAuth, requireRead, requireWrite, requireCsrf, blockIfForcePasswordChange };
