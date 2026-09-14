"use strict";
const crypto = require("crypto");
const { config } = require("../config");

function getKey() {
  const raw = config.appEncryptionKey;
  if (!raw) {
    // Geliştirme/test kolaylığı: anahtar tanımsızsa sabit (yalnızca dev) bir
    // anahtar kullanılır. config.js üretimde APP_ENCRYPTION_KEY zorunlu kılar.
    return crypto.createHash("sha256").update("dev-only-insecure-key").digest();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY 32 baytlık base64 bir değer olmalı (openssl rand -base64 32)");
  }
  return key;
}

function encryptSecret(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptSecret(stored) {
  if (!stored) return null;
  const key = getKey();
  const buf = Buffer.from(stored, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

module.exports = { encryptSecret, decryptSecret };
