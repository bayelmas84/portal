"use strict";
const crypto = require("crypto");
const audit = require("../lib/audit");

/* Hata gövdesi istemciye ayrıntı sızdırmaz; ayrıntı yalnızca sunucu günlüğüne yazılır. */
function notFound(req, res) { res.status(404).json({ error: "Bulunamadı" }); }

/* Günlükte maskeleme: "elif.yalcin" -> "el***", "10.1.2.3" -> "10.***" */
function mask(v) {
  if (!v) return null;
  const s = String(v);
  return s.slice(0, 2) + "***";
}

function handler(logger) {
  return async function (err, req, res, next) { // eslint-disable-line no-unused-vars
    /* Doğrulama hatası kullanıcı hatasıdır: 400 döner, alan adları bildirilir. */
    if (err && (err.name === "ZodError" || Array.isArray(err.issues))) {
      return res.status(400).json({
        error: "Girdi doğrulaması başarısız",
        fields: (err.issues || []).map((i) => ({ alan: i.path.join("."), mesaj: i.message })),
      });
    }
    if (err && err.code === "LIMIT_FILE_SIZE")
      return res.status(413).json({ error: "Dosya boyutu sınırı aşıldı" });
    const status = err.status || err.statusCode || 500;
    /* Referans kodu kriptografik üreteçten alınır; tahmin edilebilir olmamalı. */
    const ref = crypto.randomBytes(5).toString("hex");
    /* Kişisel veri konsola açıkça yazılmaz; tam kayıt saklama süresine tabi tablolarda tutulur. */
    logger.error({ err, ref, path: req.path, user: mask(req.user && req.user.username) }, "istek hatası");
    if (status >= 500) {
      try {
        await audit.record("hata.sunucu", (req.user && req.user.username) || "anonim",
          { ok: false, detail: { ref, path: req.path } });
      } catch (_) {}
    }
    res.status(status).json({
      error: status >= 500 ? "Beklenmeyen hata" : (err.publicMessage || err.message || "İstek reddedildi"),
      ref,
    });
  };
}
module.exports = { notFound, handler };
