"use strict";
// Mail şablonları: her bildirim türü (doküman ataması, eğitim ataması, onay
// akışı bildirimleri vb.) için tanım. KURAL (kullanıcı isteği): giriş, değişiklik
// VE silme — hepsi aynı çift onay akışına (önce yönetici, sonra Teftiş) tabidir.
// Bu yüzden gerçek tabloya YAZMA işlemi burada yapılmaz; bir approval_requests
// kaydı açılır (kind: template.create/update/delete), gerçek uygulama decide
// ucunda (announcements.js) onay tamamlanınca gerçekleşir.
const express = require("express");
const { query } = require("../db");
const { requireRead, requireWrite } = require("../middleware/auth");
const { audit } = require("../lib/audit");
const { notifyApprovalCreated } = require("../lib/notify");

const router = express.Router();

// Kod içinde GERÇEKTEN tetiklenen olaylar — admin panelinde referans olarak gösterilir.
// Yönetici bunların DIŞINDA yeni event_key'lerle şablon oluşturabilir (ileride
// koda bağlanacak akışlar için hazırlık amacıyla), ama o şablonlar koddan
// otomatik tetiklenmez, yalnızca burada listelenenler tetiklenir.
const WIRED_EVENTS = [
  ["training.assigned", "Eğitim/doküman ataması", "{ad_soyad}, {egitim_adi}, {son_tarih}, {doc_no}"],
  ["approval.submitted", "Talep alındı (talep edene)", "{ad_soyad}, {konu}, {tur}"],
  ["approval.pending", "Onayınızı bekleyen iş var (onaycıya)", "{ad_soyad}, {konu}, {tur}"],
  ["approval.approved", "Talebiniz onaylandı", "{ad_soyad}, {konu}"],
  ["approval.rejected", "Talebiniz reddedildi", "{ad_soyad}, {konu}, {gerekce}"],
];

router.get("/wired-events", requireRead("m.mailtpl"), (req, res) => {
  res.json({ items: WIRED_EVENTS.map(([key, label, vars]) => ({ key, label, vars })) });
});

router.get("/", requireRead("m.mailtpl"), async (req, res, next) => {
  try {
    const { rows } = await query(
      "SELECT * FROM notification_templates ORDER BY event_key"
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

async function openTwoStepApproval(req, res, kind, subject, targetId, payload) {
  if (!req.user.manager_username) {
    return res.status(409).json({ error: "Yöneticiniz tanımlı değil, bu işlem onaya gönderilemiyor." });
  }
  const insp = await query(
    "SELECT username FROM users WHERE role='inspection' AND active AND username != $1 ORDER BY username LIMIT 1",
    [req.user.username]
  );
  if (!insp.rowCount) return res.status(409).json({ error: "Tanımlı bir Teftiş kullanıcısı yok, işlem onaya gönderilemiyor." });
  await query(
    `INSERT INTO approval_requests (kind, subject, category, target_type, target_id, requested_by, approver, reason, payload, step, total_steps)
     VALUES ($1,$2,'Genel','notification_template',$3,$4,$5,$6,$7,1,2)`,
    [kind, subject, targetId, req.user.username, req.user.manager_username, subject, JSON.stringify(payload)]
  );
  await audit(`Mail şablonu işlemi onaya gönderildi (1/2 — yönetici onayı bekleniyor): ${subject}`, req.user.username,
    true, { actionType: kind === "template.delete" ? "silme" : "onay", approvers: [req.user.manager_username] });
  await notifyApprovalCreated({ requestedBy: req.user.username, approver: req.user.manager_username, subject, kind: "Mail şablonu" });
  res.status(202).json({ ok: true, pending: true, message: "Onaya gönderildi (sırayla: yöneticiniz, sonra Teftiş)." });
}

router.post("/", requireWrite("m.mailtpl"), async (req, res, next) => {
  try {
    const { eventKey, name, subject, body } = req.body || {};
    if (!eventKey || !/^[a-z0-9.]{3,64}$/.test(eventKey)) {
      return res.status(400).json({ error: "Olay anahtarı yalnızca küçük harf, rakam ve nokta içerebilir." });
    }
    if (!name || !name.trim()) return res.status(400).json({ error: "Şablon adı zorunlu." });
    if (!subject || !subject.trim()) return res.status(400).json({ error: "Konu zorunlu." });
    if (!body || !body.trim()) return res.status(400).json({ error: "Mail metni zorunlu." });
    const existing = await query("SELECT 1 FROM notification_templates WHERE event_key=$1", [eventKey]);
    if (existing.rowCount) return res.status(409).json({ error: "Bu olay anahtarı için zaten bir şablon var." });
    await openTwoStepApproval(req, res, "template.create", `Yeni mail şablonu: ${name.trim()} (${eventKey})`,
      null, { eventKey, name: name.trim(), subject: subject.trim(), body: body.trim() });
  } catch (e) { next(e); }
});

router.put("/:id", requireWrite("m.mailtpl"), async (req, res, next) => {
  try {
    const { name, subject, body, status } = req.body || {};
    const existing = await query("SELECT * FROM notification_templates WHERE id=$1", [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: "Şablon bulunamadı." });
    if (status && !["aktif", "kapali"].includes(status)) return res.status(400).json({ error: "Geçersiz durum." });
    await openTwoStepApproval(req, res, "template.update", `Mail şablonu güncelleme: ${existing.rows[0].name}`,
      req.params.id, { name, subject, body, status });
  } catch (e) { next(e); }
});

router.delete("/:id", requireWrite("m.mailtpl"), async (req, res, next) => {
  try {
    const existing = await query("SELECT * FROM notification_templates WHERE id=$1", [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: "Şablon bulunamadı." });
    await openTwoStepApproval(req, res, "template.delete", `Mail şablonu silme: ${existing.rows[0].name}`,
      req.params.id, {});
  } catch (e) { next(e); }
});

module.exports = router;
