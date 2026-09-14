#!/usr/bin/env node
"use strict";
/* Portal kullanıcısı tanımlar. Parola saklanmaz; kimlik doğrulama Active Directory üzerinden yapılır.
   Kullanım:
     node ops/create-user.js <kullanici_adi> "<Ad Soyad>" <rol> <birim_kodu> <unvan_kodu> [yonetici_kullanici_adi]
   Örnek:
     node ops/create-user.js bayram.elmas "Bayram Elmas" pmdir BT PYD elif.yalcin */
const { load } = require("../server/src/config");
const db = require("../server/src/lib/db");
const audit = require("../server/src/lib/audit");

(async () => {
  const [username, displayName, role, unit, title, manager] = process.argv.slice(2);
  if (!username || !displayName || !role) {
    console.error('Kullanım: node ops/create-user.js <kullanici_adi> "<Ad Soyad>" <rol> [birim] [unvan] [yonetici]');
    process.exit(1);
  }
  if (!/^[a-z0-9._-]{2,64}$/.test(username)) { console.error("Kullanıcı adı biçimi geçersiz."); process.exit(1); }
  const cfg = load(); db.init(cfg); audit.setKey(cfg);

  const r = await db.one("SELECT key, label FROM roles WHERE key = $1", [role]);
  if (!r) {
    const all = await db.many("SELECT key FROM roles ORDER BY key");
    console.error(`Tanımsız rol: ${role}. Geçerli roller: ${all.map((x) => x.key).join(", ")}`);
    process.exit(1);
  }
  if (title) {
    const t = await db.one("SELECT code FROM titles WHERE code = $1 AND active", [title]);
    if (!t) { console.error(`Tanımsız veya pasif ünvan: ${title}`); process.exit(1); }
  }
  if (await db.one("SELECT username FROM users WHERE username = $1", [username])) {
    console.error("Bu kullanıcı zaten kayıtlı."); process.exit(1);
  }
  await db.query(
    `INSERT INTO users (username, display_name, role_key, unit_code, title_code, manager, active, email)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)`,
    [username, displayName, role, unit || null, title || null, manager || null, `${username}@${cfg.MAIL_DOMAIN}`]);
  await audit.record("kullanici.eklendi", "kurulum", { detail: { username, rol: role, unvan: title || null } });
  console.log(`Kullanıcı tanımlandı: ${displayName} (${username}) · rol ${r.label}${title ? ` · ünvan ${title}` : ""}`);
  /* Kural gereği bu betik kimlik bilgisi almaz, yazmaz ve günlüğe basmaz. */
  console.log("Giriş Active Directory üzerinden doğrulanır; portal kimlik bilgisi saklamaz.");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
