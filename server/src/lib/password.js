"use strict";
// Yerel (mock/AD-kapalı) mod için parola hashleme. AD aktifken bu modül hiç
// kullanılmaz — kimlik doğrulama LDAP üzerinden yapılır.
const argon2 = require("argon2");

async function hashPassword(plain) {
  return argon2.hash(plain, { type: argon2.argon2id });
}

async function verifyPassword(hash, plain) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, plain);
  } catch (e) {
    return false;
  }
}

// Basit parola politikası: en az 8 karakter, en az bir harf ve bir rakam.
function validatePasswordPolicy(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "Şifre en az 8 karakter olmalı.";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(pw)) return "Şifre en az bir harf içermeli.";
  if (!/[0-9]/.test(pw)) return "Şifre en az bir rakam içermeli.";
  return null;
}

module.exports = { hashPassword, verifyPassword, validatePasswordPolicy };
