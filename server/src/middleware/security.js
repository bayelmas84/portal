"use strict";
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { config } = require("../config");

const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "same-origin" },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: config.loginMaxAttempts,
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
