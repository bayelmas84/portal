"use strict";
/* Kuyruktaki e-postaları SMTP'ye teslim eder.
   Ayarlar Admin Panel'den (mail_settings) gelir; kayıt yoksa .env değerlerine düşer. */
const nodemailer = require("nodemailer");
const db = require("./db");
const mailconfig = require("./mailconfig");

function buildTransport(eff) {
  if (!eff.host) return null;
  return nodemailer.createTransport({
    host: eff.host,
    port: eff.port,
    secure: eff.encryption === "tls",                 // 465 için doğrudan TLS
    requireTLS: eff.encryption === "starttls",        // 587 için STARTTLS zorunlu
    ignoreTLS: eff.encryption === "none",
    auth: eff.authUser ? { user: eff.authUser, pass: eff.authPass || "" } : undefined,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    pool: true,
    maxConnections: 3,
  });
}

/* Bağlantı denemesi: kimlik doğrulama ve TLS sınanır, gerçek posta gönderilmez. */
async function verify(cfg) {
  const eff = await mailconfig.effective(cfg);
  if (!eff.host) {
    /* Sonuç ekranda görünsün diye tanımsızlık da kayda geçer. */
    await mailconfig.recordTest(false, "SMTP sunucusu tanımlı değil");
    return { ok: false, error: "SMTP sunucusu tanımlı değil" };
  }
  const tx = buildTransport(eff);
  try {
    await tx.verify();
    await mailconfig.recordTest(true, null);
    return { ok: true, host: eff.host, port: eff.port, encryption: eff.encryption, source: eff.source };
  } catch (e) {
    await mailconfig.recordTest(false, e.message);
    return { ok: false, error: e.message, host: eff.host, port: eff.port };
  } finally { if (tx && tx.close) tx.close(); }
}

/* Tek deneme e-postası. Alıcı, isteği yapan yöneticinin adresidir. */
async function sendTest(cfg, recipient) {
  const eff = await mailconfig.effective(cfg);
  if (!eff.host) {
    await mailconfig.recordTest(false, "SMTP sunucusu tanımlı değil");
    return { ok: false, error: "SMTP sunucusu tanımlı değil" };
  }
  const tx = buildTransport(eff);
  try {
    await tx.sendMail({
      from: eff.from, to: recipient, replyTo: eff.replyTo || undefined,
      subject: "Tera Portal — e-posta ayarı deneme mesajı",
      text: "Bu mesaj Tera Portal e-posta ayarlarının doğrulanması için gönderilmiştir.\n\n"
          + `Sunucu: ${eff.host}:${eff.port} (${eff.encryption})\nKaynak: ${eff.source}\n`,
      headers: { "Auto-Submitted": "auto-generated" },
    });
    await mailconfig.recordTest(true, null);
    return { ok: true, recipient };
  } catch (e) {
    await mailconfig.recordTest(false, e.message);
    return { ok: false, error: e.message };
  } finally { if (tx && tx.close) tx.close(); }
}

async function flush(cfg, limit = 50) {
  const eff = await mailconfig.effective(cfg);
  const rows = await db.many(
    `SELECT id, recipient, subject, body FROM mail_outbox
      WHERE sent_at IS NULL ORDER BY id ASC LIMIT $1`, [limit]);
  if (!rows.length) return { sent: 0, failed: 0, pending: 0, source: eff.source };
  if (!eff.host) return { sent: 0, failed: 0, pending: rows.length, note: "SMTP sunucusu tanımlı değil" };

  const tx = buildTransport(eff);
  let sent = 0, failed = 0;
  for (const m of rows) {
    try {
      await tx.sendMail({
        from: eff.from, to: m.recipient, replyTo: eff.replyTo || undefined,
        subject: m.subject, text: m.body, headers: { "Auto-Submitted": "auto-generated" },
      });
      await db.query("UPDATE mail_outbox SET sent_at = now(), error = NULL WHERE id = $1", [m.id]);
      sent++;
    } catch (e) {
      await db.query("UPDATE mail_outbox SET error = $1 WHERE id = $2", [String(e.message).slice(0, 500), m.id]);
      failed++;
    }
  }
  if (tx && tx.close) tx.close();
  const left = await db.one("SELECT COUNT(*)::int AS n FROM mail_outbox WHERE sent_at IS NULL");
  return { sent, failed, pending: left ? left.n : 0, source: eff.source };
}
module.exports = { flush, verify, sendTest, buildTransport };
