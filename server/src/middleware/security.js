"use strict";
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");

/* Güvenlik başlıkları — CSP inline script'e izin vermez, nonce kullanılır. */
function headers(cfg) {
  return [
    (req, res, next) => { res.locals.nonce = crypto.randomBytes(16).toString("base64"); next(); },
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
          "style-src": ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`],
          "img-src": ["'self'", "data:", "blob:"],
          "object-src": ["'none'"],
          "frame-src": ["'self'", "blob:"],
          "frame-ancestors": ["'none'"],
          "base-uri": ["'none'"],
          "form-action": ["'self'"],
          "connect-src": ["'self'"],
          "upgrade-insecure-requests": [],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: cfg.NODE_ENV === "production" ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
      referrerPolicy: { policy: "same-origin" },
      frameguard: { action: "deny" },
      noSniff: true,
      xssFilter: true,
    }),
    (req, res, next) => {
      res.setHeader("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()");
      res.setHeader("Cache-Control", "no-store");
      res.removeHeader("X-Powered-By");
      next();
    },
  ];
}

const loginLimiter = (cfg) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: cfg.LOGIN_MAX_ATTEMPTS,
  standardHeaders: true, legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Çok fazla hatalı giriş. 15 dakika sonra yeniden deneyin." },
});

const apiLimiter = () => rateLimit({
  windowMs: 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: "İstek sınırı aşıldı" },
});

const writeLimiter = () => rateLimit({
  windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false,
  message: { error: "Çok fazla değişiklik isteği" },
});

/* Çift gönderim (double-submit) CSRF: çerezdeki değer ile başlıktaki değer eşleşmeli. */
function csrf(cfg) {
  const COOKIE = "tp_csrf";
  return {
    issue(req, res, next) {
      if (!req.cookies || !req.cookies[COOKIE]) {
        const token = crypto.randomBytes(32).toString("base64url");
        res.cookie(COOKIE, token, {
          httpOnly: false, secure: cfg.NODE_ENV === "production", sameSite: "strict", path: "/api",
        });
        req.csrfToken = token;
      } else req.csrfToken = req.cookies[COOKIE];
      next();
    },
    verify(req, res, next) {
      if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
      const cookie = req.cookies && req.cookies[COOKIE];
      const header = req.get("x-csrf-token");
      if (!cookie || !header || cookie.length !== header.length ||
          !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header)))
        return res.status(403).json({ error: "CSRF doğrulaması başarısız" });
      next();
    },
  };
}
module.exports = { headers, loginLimiter, apiLimiter, writeLimiter, csrf };
