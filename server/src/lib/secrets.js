"use strict";
/* Veritabanında saklanan sırların şifrelenmesi (AES-256-GCM).
   Anahtar .env içindeki APP_ENCRYPTION_KEY'dir; veritabanı yedeği tek başına parolayı vermez. */
const crypto = require("crypto");

const keyOf = (cfg) => {
  const raw = Buffer.from(cfg.APP_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) throw new Error("APP_ENCRYPTION_KEY 32 bayt (base64) olmalı");
  return raw;
};

function encrypt(plain, cfg) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", keyOf(cfg), iv);
  const enc = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), enc.toString("base64"), c.getAuthTag().toString("base64")].join(":");
}

function decrypt(payload, cfg) {
  if (!payload) return null;
  const [ver, iv, data, tag] = String(payload).split(":");
  if (ver !== "v1") throw new Error("Desteklenmeyen şifreleme sürümü");
  const d = crypto.createDecipheriv("aes-256-gcm", keyOf(cfg), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/* Anahtar üretimi: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
module.exports = { encrypt, decrypt };
