"use strict";
// Merkezi bildirim mekanizması: her olay (eğitim ataması, doküman ataması,
// onay akışı adımları) burada tanımlı bir "event_key" ile notification_templates
// tablosundaki AKTİF şablonu bulur, {yer_tutucu} alanlarını doldurur ve
// mailer.sendMail ile gönderir. Şablon tanımlı/aktif değilse SESSİZCE atlanır
// (bildirim gönderilmemesi bir hata değildir — yönetici henüz o şablonu
// oluşturmamış veya kapatmış olabilir).
const { query } = require("../db");
const { sendMail } = require("./mailer");

function render(str, vars) {
  return String(str || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : ""));
}

async function getActiveTemplate(eventKey) {
  const { rows } = await query(
    "SELECT * FROM notification_templates WHERE event_key=$1 AND status='aktif'",
    [eventKey]
  );
  return rows[0] || null;
}

/**
 * Bir olay için tanımlı şablonu bulup e-postayı gönderir.
 * @param {string} eventKey - örn. 'training.assigned', 'approval.pending'
 * @param {string} toEmail - alıcının e-posta adresi
 * @param {object} vars - şablondaki {yer_tutucu} alanlarını dolduracak değerler
 */
async function notifyEvent(eventKey, toEmail, vars) {
  if (!toEmail) return false;
  const tpl = await getActiveTemplate(eventKey);
  if (!tpl) return false; // şablon tanımlı/aktif değil — sessizce atla
  const subject = render(tpl.subject, vars || {});
  const body = render(tpl.body, vars || {});
  return sendMail(toEmail, subject, body);
}

/** Kullanıcı adından e-posta adresini bulur (bildirim göndermek için). */
async function emailOf(username) {
  if (!username) return null;
  const { rows } = await query("SELECT email FROM users WHERE username=$1", [username]);
  return rows[0] ? rows[0].email : null;
}

/**
 * Bir approval_requests satırı YENİ oluşturulduğunda çağrılır: talebi açana
 * "talebiniz alındı", yeni onaycıya "onayınızı bekleyen bir iş var" bildirimi
 * gönderir. Kullanıcının isteği: "onayınızı bekleyen şu iş var, ya da şu
 * talebiniz alındı onaylandı gibi bir email akışı olsun."
 */
async function notifyApprovalCreated({ requestedBy, approver, subject, kind }) {
  const [reqEmail, apprEmail, reqName, apprName] = await Promise.all([
    emailOf(requestedBy), emailOf(approver),
    nameOf(requestedBy), nameOf(approver),
  ]);
  await notifyEvent("approval.submitted", reqEmail, { ad_soyad: reqName, konu: subject, tur: kind });
  await notifyEvent("approval.pending", apprEmail, { ad_soyad: apprName, konu: subject, tur: kind });
}

/** Bir talep karara bağlandığında (onaylandı/reddedildi) talep sahibine bildirim gönderir. */
async function notifyApprovalDecided({ requestedBy, subject, decision, decisionReason }) {
  const [reqEmail, reqName] = await Promise.all([emailOf(requestedBy), nameOf(requestedBy)]);
  const eventKey = decision === "onayla" ? "approval.approved" : "approval.rejected";
  await notifyEvent(eventKey, reqEmail, { ad_soyad: reqName, konu: subject, gerekce: decisionReason || "" });
}

async function nameOf(username) {
  if (!username) return "";
  const { rows } = await query("SELECT name FROM users WHERE username=$1", [username]);
  return rows[0] ? rows[0].name : username;
}

module.exports = { notifyEvent, notifyApprovalCreated, notifyApprovalDecided, emailOf, nameOf };
