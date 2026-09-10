"use strict";
/* Active Directory ayarları Admin Panel > Dizin (AD) ayarları ekranından yönetilir.
   Servis hesabı parolası AES-256-GCM ile şifreli saklanır ve hiçbir uçtan geri dönmez.
   Kayıt yoksa .env değerlerine düşülür, böylece ilk kurulumda da giriş yapılabilir. */
const db = require("./db");
const secrets = require("./secrets");

const row = () => db.one("SELECT * FROM directory_settings WHERE id = 1");

async function effective(cfg) {
  const r = await row();
  const useDb = r && r.active && r.url && r.bind_dn;
  return {
    source: useDb ? "veritabanı" : (cfg.LDAP_BIND_DN ? ".env" : "tanımsız"),
    configured: !!useDb || !!cfg.LDAP_BIND_DN,
    url: useDb ? r.url : cfg.LDAP_URL,
    baseDn: useDb ? r.base_dn : cfg.LDAP_BASE_DN,
    bindDn: useDb ? r.bind_dn : cfg.LDAP_BIND_DN,
    bindPassword: useDb && r.bind_password_enc
      ? secrets.decrypt(r.bind_password_enc, cfg)
      : cfg.LDAP_BIND_PASSWORD,
    userFilter: useDb ? r.user_filter : cfg.LDAP_USER_FILTER,
    rejectUnauthorized: useDb ? r.tls_verify : cfg.LDAP_TLS_REJECT_UNAUTHORIZED !== "false",
    /* Dizinde bulunan ama portalda tanımlı olmayan kullanıcıya ne olacağı */
    autoCreate: useDb ? r.auto_create_users : false,
    defaultRole: useDb ? r.default_role : "staff",
  };
}

async function forDisplay(cfg) {
  const r = await row();
  const eff = await effective(cfg);
  return {
    url: r ? r.url : null,
    baseDn: r ? r.base_dn : null,
    bindDn: r ? r.bind_dn : null,
    passwordSet: !!(r && r.bind_password_enc),
    userFilter: r ? r.user_filter : "(&(objectClass=user)(sAMAccountName={username}))",
    tlsVerify: r ? r.tls_verify : true,
    autoCreateUsers: r ? r.auto_create_users : false,
    defaultRole: r ? r.default_role : "staff",
    active: !!(r && r.active),
    lastTestAt: r ? r.last_test_at : null,
    lastTestOk: r ? r.last_test_ok : null,
    lastTestError: r ? r.last_test_error : null,
    lastTestUser: r ? r.last_test_user : null,
    updatedBy: r ? r.updated_by : null,
    updatedAt: r ? r.updated_at : null,
    effective: { source: eff.source, url: eff.url, baseDn: eff.baseDn, bindDn: eff.bindDn,
                 tlsVerify: eff.rejectUnauthorized, autoCreate: eff.autoCreate },
  };
}

async function save(v, actor, cfg) {
  const cur = await row();
  let enc = cur ? cur.bind_password_enc : null;
  if (v.bindPassword === "") enc = null;
  else if (typeof v.bindPassword === "string" && v.bindPassword.length > 0)
    enc = secrets.encrypt(v.bindPassword, cfg);

  await db.query(
    `UPDATE directory_settings
        SET url=$1, base_dn=$2, bind_dn=$3, bind_password_enc=$4, user_filter=$5,
            tls_verify=$6, auto_create_users=$7, default_role=$8, active=$9,
            updated_by=$10, updated_at=now()
      WHERE id = 1`,
    [v.url || null, v.baseDn || null, v.bindDn || null, enc, v.userFilter,
     !!v.tlsVerify, !!v.autoCreateUsers, v.defaultRole, !!v.active, actor]);
  return forDisplay(cfg);
}

const recordTest = (ok, error, username) =>
  db.query(
    `UPDATE directory_settings
        SET last_test_at = now(), last_test_ok = $1, last_test_error = $2, last_test_user = $3
      WHERE id = 1`,
    [ok, error ? String(error).slice(0, 500) : null, username || null]);

module.exports = { effective, forDisplay, save, recordTest };
