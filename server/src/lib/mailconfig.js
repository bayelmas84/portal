"use strict";
/* E-posta ayarlarının tek kaynağı: veritabanı (Admin Panel > E-posta ayarları).
   Kayıt boşsa .env değerlerine düşer, böylece kurulum ilk gün de çalışır. */
const db = require("./db");
const secrets = require("./secrets");

const ENCRYPTION_PORT = { none: 25, starttls: 587, tls: 465 };

async function row() {
  return (await db.one("SELECT * FROM mail_settings WHERE id = 1")) || null;
}

/* Gönderim için gerçek ayarlar (parola dahil). Yalnızca sunucu içinde kullanılır. */
async function effective(cfg) {
  const r = await row();
  const useDb = r && r.active && r.host;
  return {
    source: useDb ? "veritabanı" : (cfg.SMTP_HOST ? ".env" : "tanımsız"),
    active: !!useDb || !!cfg.SMTP_HOST,
    host: useDb ? r.host : cfg.SMTP_HOST || null,
    port: useDb ? r.port : cfg.SMTP_PORT || 25,
    encryption: useDb ? r.encryption : "starttls",
    authUser: useDb ? r.auth_user || null : null,
    authPass: useDb && r.auth_pass_enc ? secrets.decrypt(r.auth_pass_enc, cfg) : null,
    from: (useDb && r.from_address) || cfg.MAIL_FROM,
    replyTo: (useDb && r.reply_to) || null,
    mailDomain: (useDb && r.mail_domain) || cfg.MAIL_DOMAIN,
    groupInspection: (useDb && r.group_inspection) || cfg.MAIL_GROUP_INSPECTION,
    groupAll: (useDb && r.group_all) || cfg.MAIL_GROUP_ALL,
  };
}

/* Ekrana gönderilen hâli: parola asla dönmez, yalnızca tanımlı olup olmadığı bildirilir. */
async function forDisplay(cfg) {
  const r = await row();
  const eff = await effective(cfg);
  return {
    host: r ? r.host : null,
    port: r ? r.port : 587,
    encryption: r ? r.encryption : "starttls",
    authUser: r ? r.auth_user : null,
    passwordSet: !!(r && r.auth_pass_enc),
    fromAddress: r ? r.from_address : null,
    replyTo: r ? r.reply_to : null,
    mailDomain: r ? r.mail_domain : null,
    groupInspection: r ? r.group_inspection : null,
    groupAll: r ? r.group_all : null,
    active: !!(r && r.active),
    lastTestAt: r ? r.last_test_at : null,
    lastTestOk: r ? r.last_test_ok : null,
    lastTestError: r ? r.last_test_error : null,
    updatedBy: r ? r.updated_by : null,
    updatedAt: r ? r.updated_at : null,
    effective: {
      source: eff.source, host: eff.host, port: eff.port, from: eff.from,
      mailDomain: eff.mailDomain, groupInspection: eff.groupInspection, groupAll: eff.groupAll,
    },
    defaults: { ...ENCRYPTION_PORT },
  };
}

/* Parola alanı boş gelirse mevcut parola korunur; "" gönderilirse silinir. */
async function save(values, actor, cfg) {
  const cur = await row();
  let passEnc = cur ? cur.auth_pass_enc : null;
  if (values.password === "") passEnc = null;
  else if (typeof values.password === "string" && values.password.length > 0)
    passEnc = secrets.encrypt(values.password, cfg);

  await db.query(
    `UPDATE mail_settings
        SET host=$1, port=$2, encryption=$3, auth_user=$4, auth_pass_enc=$5,
            from_address=$6, reply_to=$7, mail_domain=$8, group_inspection=$9, group_all=$10,
            active=$11, updated_by=$12, updated_at=now()
      WHERE id = 1`,
    [values.host || null, values.port, values.encryption, values.authUser || null, passEnc,
     values.fromAddress || null, values.replyTo || null, values.mailDomain || null,
     values.groupInspection || null, values.groupAll || null, !!values.active, actor]);
  return forDisplay(cfg);
}

async function recordTest(ok, error) {
  await db.query(
    "UPDATE mail_settings SET last_test_at = now(), last_test_ok = $1, last_test_error = $2 WHERE id = 1",
    [ok, error ? String(error).slice(0, 500) : null]);
}

module.exports = { effective, forDisplay, save, recordTest, ENCRYPTION_PORT };
