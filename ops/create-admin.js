#!/usr/bin/env node
"use strict";
/* İlk yöneticiyi tanımlar. Parola saklanmaz; kimlik doğrulama AD üzerinden yapılır.
   Kullanım: node ops/create-admin.js <kullanici_adi> "<Ad Soyad>" [birim_kodu] [unvan_kodu] */
const { load } = require("../server/src/config");
const db = require("../server/src/lib/db");
const audit = require("../server/src/lib/audit");

(async () => {
  const [username, displayName, unit = "BT", title = "DIR"] = process.argv.slice(2);
  if (!username || !displayName) {
    console.error('Kullanım: node ops/create-admin.js <kullanici_adi> "<Ad Soyad>" [birim] [unvan]');
    process.exit(1);
  }
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) { console.error("Kullanıcı adı biçimi geçersiz."); process.exit(1); }
  const cfg = load(); db.init(cfg);
  const exists = await db.one("SELECT username FROM users WHERE username=$1", [username]);
  if (exists) { console.error("Bu kullanıcı zaten kayıtlı."); process.exit(1); }
  await db.query(
    `INSERT INTO users (username, display_name, role_key, unit_code, title_code, active, email)
     VALUES ($1,$2,'admin',$3,$4,TRUE,$5)`,
    [username, displayName, unit, title, `${username}@${cfg.MAIL_DOMAIN}`]);
  await audit.record("kurulum.ilk_admin", "kurulum", { detail: { username } });
  console.log(`Yönetici tanımlandı: ${displayName} (${username}). Giriş AD parolasıyla yapılır.`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
