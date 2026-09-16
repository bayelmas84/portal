"use strict";
const nodemailer = require("nodemailer");
const { query } = require("../db");
const { decryptSecret, encryptSecret } = require("./crypto");
const { audit } = require("./audit");

async function getSmtpSettings() {
  const { rows } = await query("SELECT * FROM smtp_settings WHERE id = 1");
  return rows[0];
}

async function saveSmtpSettings({ host, port, fromAddr, fromName, username, password, tls, updatedBy }) {
  const s = await getSmtpSettings();
  const passwordEncrypted = password ? encryptSecret(password) : s.password_encrypted;
  await query(
    `UPDATE smtp_settings SET host=$1, port=$2, from_addr=$3, from_name=$4, username=$5,
       password_encrypted=$6, tls=$7, updated_by=$8, updated_at=now() WHERE id=1`,
    [host, port, fromAddr, fromName || s.from_name || "BY Portal", username, passwordEncrypted, tls, updatedBy]
  );
  await audit(`SMTP ayarları güncellendi (parola ${password ? "değişti" : "korundu"})`, updatedBy);
}

async function setSmtpActive(active, updatedBy) {
  await query("UPDATE smtp_settings SET active=$1, updated_by=$2, updated_at=now() WHERE id=1", [
    active,
    updatedBy,
  ]);
  await audit(`SMTP ${active ? "etkinleştirildi" : "devre dışı bırakıldı"}`, updatedBy);
}

function buildTransport(s, password) {
  return nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: false, // STARTTLS kullanılır (port 587 tipik)
    requireTLS: !!s.tls,
    auth: s.username ? { user: s.username, pass: password } : undefined,
    connectionTimeout: 8000,
  });
}

/** Gerçekten SMTP'ye bağlanıp doğrular (mesaj göndermeden). */
async function testSmtpConnection() {
  const s = await getSmtpSettings();
  if (!s.host || !s.from_addr) {
    return { ok: false, msg: "Önce sunucu ve gönderen adresini kaydedin." };
  }
  const password = decryptSecret(s.password_encrypted);
  try {
    const transport = buildTransport(s, password);
    await transport.verify();
    await query(
      "UPDATE smtp_settings SET last_test_at=now(), last_test_ok=true, last_test_msg=$1 WHERE id=1",
      ["Sunucuya bağlanıldı ve kimlik doğrulandı."]
    );
    return { ok: true, msg: "Bağlantı kuruldu." };
  } catch (e) {
    await query(
      "UPDATE smtp_settings SET last_test_at=now(), last_test_ok=false, last_test_msg=$1 WHERE id=1",
      [e.message]
    );
    return { ok: false, msg: e.message };
  }
}

/**
 * Gerçekten e-posta gönderir — YALNIZCA smtp_settings.active=true ise.
 * Etkin değilse hiçbir şey göndermez, denetim kaydına başarısızlık yazar ve
 * false döner; çağıran taraf (route) buna göre kullanıcıya doğru mesajı verir.
 */
async function sendMail(to, subject, text) {
  const s = await getSmtpSettings();
  if (!s.active) {
    await audit(`E-posta gönderilemedi (SMTP tanımlı/etkin değil): ${subject}`, "sistem", false);
    return false;
  }
  const password = decryptSecret(s.password_encrypted);
  try {
    const transport = buildTransport(s, password);
    // Görünen ad + adres birlikte gönderilir: "BY Portal <portal@byelmas.com>"
    const from = s.from_name ? `"${s.from_name}" <${s.from_addr}>` : s.from_addr;
    await transport.sendMail({ from, to, subject, text: text || subject });
    await query("INSERT INTO mail_log (to_addr, subject) VALUES ($1,$2)", [to, subject]);
    return true;
  } catch (e) {
    await audit(`E-posta gönderimi başarısız (${to}): ${e.message}`, "sistem", false);
    return false;
  }
}

module.exports = {
  getSmtpSettings,
  saveSmtpSettings,
  setSmtpActive,
  testSmtpConnection,
  sendMail,
};
