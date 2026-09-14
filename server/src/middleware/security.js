"use strict";
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { query } = require("../db");
const { config } = require("../config");

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      // index.html tek dosyalık bir uygulamadır ve gömülü <script>/<style>
      // kullanır; bu nedenle 'unsafe-inline' gereklidir (bkz. KURULUM.md notu).
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-origin" },
});

// login_max_attempts admin panelinden (onaylı) değiştirilebilir; DB'ye her
// istekte gitmemek için kısa süreli (30sn) bellek içi önbellek kullanılır.
let cachedMaxAttempts = null;
let cacheExpiresAt = 0;
async function getLoginMaxAttempts() {
  if (cachedMaxAttempts !== null && Date.now() < cacheExpiresAt) return cachedMaxAttempts;
  try {
    const { rows } = await query("SELECT value FROM app_settings WHERE key='login_max_attempts'");
    cachedMaxAttempts = rows[0] ? Number(rows[0].value) : config.loginMaxAttempts;
  } catch (e) {
    cachedMaxAttempts = config.loginMaxAttempts; // tablo henüz yoksa (eski migration) .env'e düş
  }
  cacheExpiresAt = Date.now() + 30000;
  return cachedMaxAttempts;
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: getLoginMaxAttempts,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Çok fazla başarısız giriş denemesi. Lütfen daha sonra tekrar deneyin." },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

function notFound(req, res) {
  res.status(404).json({ error: "Bulunamadı." });
}

// Bilgi sızıntısını önlemek için 5xx hatalarında yalnızca genel mesaj döner;
// gerçek hata sunucu loguna yazılır, istemciye asla stack/iç detay gönderilmez.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // eslint-disable-next-line no-console
  console.error("[hata]", err);
  const status = err.status || 500;
  if (status >= 500) {
    return res.status(500).json({ error: "Sunucu hatası. Lütfen daha sonra tekrar deneyin." });
  }
  res.status(status).json({ error: err.message || "İstek işlenemedi." });
}

module.exports = { securityHeaders, loginLimiter, apiLimiter, notFound, errorHandler };
