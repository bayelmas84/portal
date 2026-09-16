"use strict";
// Mail şablonları: her bildirim türü (doküman ataması, eğitim ataması, onay
// akışı bildirimleri vb.) için tanım. KURAL (kullanıcı isteği): giriş, değişiklik
// VE silme — hepsi aynı çift onay akışına (önce yönetici, sonra Teftiş) tabidir.
// Bu yüzden gerçek tabloya YAZMA işlemi burada yapılmaz; bir approval_requests
// kaydı açılır (kind: template.create/update/delete), gerçek uygulama decide
// ucunda (announcements.js) onay tamamlanınca gerçekleşir.
const express = require("express");
const { query } = require("../db");
const { requireRead, requireWrite, requireAuth } = require("../middleware/auth");
const { sendMail } = require("../lib/mailer");
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

// ------------------------- Mail bildirim tercihleri -------------------------
// Bu route'lar BİLEREK dosyanın en başında tanımlanır: aşağıdaki
// PUT/DELETE /:id (mail şablonu) route'larından ÖNCE gelmezse Express
// "/prefs" isteğini yanlışlıkla :id="prefs" olarak eşleştirir ve
// m.mailtpl yetkisi ister (403 hatası) — bu route'lar herkese açık
// olmalı (requireAuth), tanım sırası kritik.
// Yalnızca DIŞARI GİDEN E-POSTAYI etkiler; uygulama içi (zil) bildirimler
// her zaman oluşturulur, buradan kapatılamaz.
router.get("/prefs", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query("SELECT * FROM user_notification_prefs WHERE username=$1", [req.user.username]);
    const p = rows[0] || {};
    res.json({
      emailOnComment: p.email_on_comment !== false,
      emailOnMention: p.email_on_mention !== false,
      emailOnAssignment: p.email_on_assignment !== false,
    });
  } catch (e) { next(e); }
});

router.put("/prefs", requireAuth, async (req, res, next) => {
  try {
    const b = req.body || {};
    await query(
      `INSERT INTO user_notification_prefs (username, email_on_comment, email_on_mention, email_on_assignment, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (username) DO UPDATE SET
         email_on_comment=$2, email_on_mention=$3, email_on_assignment=$4, updated_at=now()`,
      [req.user.username, b.emailOnComment !== false, b.emailOnMention !== false, b.emailOnAssignment !== false]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

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

// ------------------------------ Günlük özet ---------------------------------
// Gerçek bir zamanlanmış (cron) görev bu ortamın kapsamı dışında (sunucu
// sürekli arka planda çalışmıyor); bunun yerine kullanıcı istediği an
// "bugünün özetini" görebilir veya kendi e-postasına gönderebilir. Üretimde
// bu uç, harici bir zamanlayıcı (cron/sistem görevi) tarafından her kullanıcı
// için günde bir kez çağrılarak gerçek bir "günlük özet e-postasına" da
// dönüştürülebilir — kod değişikliği gerekmez.
async function buildDigest(username) {
  const [pendingApprovals, unreadAnn, pendingTraining] = await Promise.all([
    query(
      `SELECT id, kind, subject FROM approval_requests WHERE approver=$1 AND status='bekliyor' ORDER BY created_at DESC LIMIT 10`,
      [username]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT a.id, a.title FROM announcements a
       WHERE a.status='yayinda' AND NOT EXISTS (
         SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.username=$1)
       ORDER BY a.created_at DESC LIMIT 10`,
      [username]
    ).catch(() => ({ rows: [] })),
    query(
      `SELECT ta.id, pd.title FROM training_assignments ta JOIN policy_documents pd ON pd.id=ta.policy_document_id
       WHERE ta.username=$1 AND ta.completed_at IS NULL ORDER BY ta.due_at ASC LIMIT 10`,
      [username]
    ).catch(() => ({ rows: [] })),
  ]);
  return { pendingApprovals: pendingApprovals.rows, unreadAnnouncements: unreadAnn.rows, pendingTraining: pendingTraining.rows };
}

router.get("/daily-digest", requireAuth, async (req, res, next) => {
  try {
    const digest = await buildDigest(req.user.username);
    res.json({ ...digest, generatedAt: new Date().toISOString() });
  } catch (e) { next(e); }
});

router.post("/daily-digest/email", requireAuth, async (req, res, next) => {
  try {
    const digest = await buildDigest(req.user.username);
    const total = digest.pendingApprovals.length + digest.unreadAnnouncements.length + digest.pendingTraining.length;
    if (!total) return res.json({ ok: true, sent: false, message: "Bekleyen işiniz yok, e-posta gönderilmedi." });
    const lines = [
      `Merhaba ${req.user.name},`, "",
      digest.pendingApprovals.length ? `Onayınızı bekleyen ${digest.pendingApprovals.length} talep var.` : null,
      digest.unreadAnnouncements.length ? `${digest.unreadAnnouncements.length} okunmamış duyurunuz var: ${digest.unreadAnnouncements.map((a) => a.title).join(", ")}` : null,
      digest.pendingTraining.length ? `${digest.pendingTraining.length} bekleyen eğitim/okumanız var: ${digest.pendingTraining.map((t) => t.title).join(", ")}` : null,
      "", "Tera Portal",
    ].filter(Boolean);
    const sent = await sendMail(req.user.email, "Tera Portal — günlük özetiniz", lines.join("\n"));
    await audit(`Günlük özet e-postası gönderildi: ${req.user.username} (${sent ? "başarılı" : "SMTP kapalı"})`, req.user.username, sent);
    res.json({ ok: true, sent });
  } catch (e) { next(e); }
});

// ------------------------- Konu (issue) bildirimleri — gelen kutusu -------------------------
// Yorum/@mention/atama bildirimleri: mail gönderiminden BAĞIMSIZ olarak
// (SMTP kapalı olsa bile) kalıcı olarak burada tutulur, zil menüsünde
// gösterilir ve okundu/okunmadı takibi yapılır.
router.get("/inbox", requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT n.*, u.name AS actor_name FROM in_app_notifications n
         LEFT JOIN users u ON u.username=n.actor_username
        WHERE n.recipient_username=$1 AND n.read_at IS NULL
        ORDER BY n.created_at DESC LIMIT 30`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

router.post("/inbox/:id/read", requireAuth, async (req, res, next) => {
  try {
    await query(
      "UPDATE in_app_notifications SET read_at=now() WHERE id=$1 AND recipient_username=$2 AND read_at IS NULL",
      [req.params.id, req.user.username]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post("/inbox/read-all", requireAuth, async (req, res, next) => {
  try {
    await query(
      "UPDATE in_app_notifications SET read_at=now() WHERE recipient_username=$1 AND read_at IS NULL",
      [req.user.username]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
