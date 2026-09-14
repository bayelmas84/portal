"use strict";
// RFC 6238 TOTP (Time-based One-Time Password), harici bağımlılık olmadan,
// yalnızca Node'un yerleşik crypto modülüyle. HMAC-SHA1, 30 saniyelik pencere,
// 6 haneli kod — Google Authenticator / Microsoft Authenticator ile uyumlu.
const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = "";
  for (const byte of buf) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const rem = bits.length % 5;
  if (rem) out += BASE32_ALPHABET[parseInt(bits.slice(-rem).padEnd(5, "0"), 2)];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** Yeni rastgele bir TOTP secreti üretir (base32, authenticator app'e girilecek). */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160 bit, RFC önerisi
}

function hotp(secretBuf, counter) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secretBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

/** Verilen kodu, saat kaymasına tolerans olarak ±1 pencere (±30sn) ile doğrular. */
function verifyToken(base32Secret, token, window = 1) {
  if (!/^\d{6}$/.test(String(token || ""))) return false;
  const secretBuf = base32Decode(base32Secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (hotp(secretBuf, counter + i) === String(token)) return true;
  }
  return false;
}

/** Authenticator uygulamalarının doğrudan okuyabileceği otpauth:// URI'si. */
function otpauthUri(base32Secret, username, issuer) {
  const label = encodeURIComponent(`${issuer}:${username}`);
  return `otpauth://totp/${label}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { generateSecret, verifyToken, otpauthUri };
