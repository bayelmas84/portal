"use strict";
const express = require("express");
const { query, withTransaction } = require("../db");
const { requireRead, requireWrite } = require("../middleware/auth");
const { audit } = require("../lib/audit");
const { applyAdminAction } = require("../lib/adminActions");
const { notifyApprovalCreated, notifyApprovalDecided } = require("../lib/notify");

const router = express.Router();

function approverFor(category, requesterManager) {
  // Yasal -> Teftiş; Genel -> girenin yöneticisi. Teftiş kullanıcı adını admin
  // tablo sorgusuyla (role='inspection') buluruz; birden fazla varsa ilkini alır.
  return category === "Yasal" ? null /* çözülür aşağıda */ : requesterManager;
}

router.get("/", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, EXISTS(
         SELECT 1 FROM announcement_reads r WHERE r.announcement_id=a.id AND r.username=$1
       ) AS read_by_me
       FROM announcements a
       WHERE a.status != 'silindi' AND (a.status='yayinda' OR a.created_by=$1)
       ORDER BY a.created_at DESC`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/", requireWrite("announcements"), async (req, res, next) => {
  try {
    const { title, body, category, criticality, validUntil, popup } = req.body || {};
    if (!title || title.trim().length < 5) return res.status(400).json({ error: "Başlık en az 5 karakter olmalı." });
    if (!body || !body.trim()) return res.status(400).json({ error: "Metin zorunlu." });
    if (!["Yasal", "Genel"].includes(category)) return res.status(400).json({ error: "Geçersiz kategori." });
    const critSetting = await query(
      "SELECT value FROM app_settings WHERE key=$1",
      [category === "Yasal" ? "criticality_options_yasal" : "criticality_options_genel"]
    );
    const allowedCrits = critSetting.rowCount ? critSetting.rows[0].value.split(",") : (category === "Yasal" ? ["Kritik", "Yüksek"] : ["Yüksek", "Orta", "Düşük"]);
    if (criticality && !allowedCrits.includes(criticality)) {
      return res.status(400).json({ error: `Geçersiz kritiklik. Bu kategoride izin verilenler: ${allowedCrits.join(", ")}` });
    }

    // Onay kuralı matrisi (m.approvalrules ekranından yönetilir); tanımlı
    // değilse eski sabit davranışa (Yasal->Teftiş, Genel->yönetici) düşülür.
    const ruleRow = await query("SELECT approver_role FROM approval_rules WHERE category=$1", [category]);
    const approverRole = ruleRow.rowCount ? ruleRow.rows[0].approver_role : (category === "Yasal" ? "inspection" : "manager");

    let approver;
    if (approverRole === "manager") {
      if (!req.user.manager_username) return res.status(409).json({ error: "Yöneticiniz tanımlı değil, onaya gönderilemiyor." });
      approver = req.user.manager_username;
    } else {
      const insp = await query("SELECT username FROM users WHERE role=$1 AND active ORDER BY username LIMIT 1", [approverRole]);
      if (!insp.rowCount) return res.status(409).json({ error: `Tanımlı bir "${approverRole}" rolünde kullanıcı yok.` });
      approver = insp.rows[0].username;
    }

    const result = await withTransaction(async (client) => {
      const ann = await client.query(
        `INSERT INTO announcements (title, body, category, criticality, valid_until, popup, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'onayda',$7) RETURNING *`,
        [title.trim(), body.trim(), category, criticality || "Orta", validUntil || null, !!popup, req.user.username]
      );
      await client.query(
        `INSERT INTO approval_requests (kind, subject, category, target_type, target_id, requested_by, approver)
         VALUES ('ann.publish',$1,$2,'announcement',$3,$4,$5)`,
        [title.trim(), category, ann.rows[0].id, req.user.username, approver]
      );
      return ann.rows[0];
    });
    await audit(`Duyuru onaya gönderildi: ${title.trim()} (onaycı: ${approver})`, req.user.username);
    await notifyApprovalCreated({ requestedBy: req.user.username, approver, subject: title.trim(), kind: "Duyuru yayınlama" });
    res.status(201).json({ item: result });
  } catch (e) {
    next(e);
  }
});

// Yayındaki bir duyuru için silme talebi: yalnızca giren kişi veya Teftiş açabilir,
// zaten bekleyen bir silme talebi varsa ikinci bir tane açılmaz.
// Sıralı onay: önce talebi açanın yöneticisi, SONRA Teftiş onaylar (toplam 2 onay,
// paralel değil). Onaylanınca duyuru GERÇEKTEN silinmez — durumu "silindi" olur ve
// listeleme sorguları bunu hariç tutar (uygulama genelinde geçerli kural).
router.post("/:id/delete-request", requireWrite("announcements"), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason || reason.trim().length < 10) return res.status(400).json({ error: "Gerekçe en az 10 karakter olmalı." });
    const { rows } = await query("SELECT * FROM announcements WHERE id=$1", [req.params.id]);
    const ann = rows[0];
    if (!ann) return res.status(404).json({ error: "Duyuru bulunamadı." });
    if (ann.status !== "yayinda") return res.status(409).json({ error: "Yalnızca yayındaki duyurular için silme talebi açılabilir." });
    const isOwner = ann.created_by === req.user.username;
    const isInspector = req.user.role === "inspection";
    if (!isOwner && !isInspector) return res.status(403).json({ error: "Bu duyuruyu silme talebi açma yetkiniz yok." });

    const pending = await query(
      "SELECT 1 FROM approval_requests WHERE kind='ann.delete' AND target_id=$1 AND status='bekliyor'",
      [ann.id]
    );
    if (pending.rowCount) return res.status(409).json({ error: "Bu duyuru için zaten bekleyen bir silme talebi var." });

    if (!req.user.manager_username) return res.status(409).json({ error: "Yöneticiniz tanımlı değil, silme talebi açılamıyor." });
    const insp = await query(
      "SELECT username FROM users WHERE role='inspection' AND active AND username != $1 ORDER BY username LIMIT 1",
      [req.user.username]
    );
    if (!insp.rowCount) return res.status(409).json({ error: "Tanımlı bir Teftiş kullanıcısı yok, silme talebi açılamıyor." });

    // Yalnızca 1. adım (yönetici) burada açılır; Teftiş adımı yönetici onaylayınca otomatik açılır.
    await query(
      `INSERT INTO approval_requests (kind, subject, category, target_type, target_id, requested_by, approver, reason, step, total_steps)
       VALUES ('ann.delete',$1,$2,'announcement',$3,$4,$5,$6,1,2)`,
      [ann.title, ann.category, ann.id, req.user.username, req.user.manager_username, reason.trim()]
    );
    await audit(`Duyuru silme talebi açıldı (1/2 — yönetici onayı bekleniyor): ${ann.title}`, req.user.username,
      true, { actionType: "silme", approvers: [req.user.manager_username] });
    await notifyApprovalCreated({ requestedBy: req.user.username, approver: req.user.manager_username, subject: ann.title, kind: "Duyuru silme" });
    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});

router.post("/:id/read", requireRead("announcements"), async (req, res, next) => {
  try {
    await query(
      `INSERT INTO announcement_reads (announcement_id, username) VALUES ($1,$2)
       ON CONFLICT DO NOTHING`,
      [req.params.id, req.user.username]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Onay kutusu: onaycısı ben olan TÜM talepler (durum farketmez — açık/onaylanan/
// reddedilen). Varsayılan filtreleme (yalnızca açık gösterme) frontend'de yapılır;
// backend hepsini döner ki dropdown'dan geçmişe de bakılabilsin.
router.get("/requests/inbox", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM approval_requests WHERE approver=$1 ORDER BY created_at DESC`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

// Onay kutusu: benim açtığım TÜM talepler (durum farketmez).
router.get("/requests/mine", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM approval_requests WHERE requested_by=$1 ORDER BY created_at DESC`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

// Onay kutusu: karara bağladığım talepler (onayladığım veya reddettiğim)
router.get("/requests/done", requireRead("announcements"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM approval_requests WHERE approver=$1 AND status IN ('onaylandi','reddedildi') ORDER BY decided_at DESC`,
      [req.user.username]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

router.post("/requests/:id/decide", requireRead("announcements"), async (req, res, next) => {
  try {
    const { decision, reason } = req.body || {}; // 'onayla' | 'reddet'
    const { rows } = await query("SELECT * FROM approval_requests WHERE id=$1", [req.params.id]);
    const reqRow = rows[0];
    if (!reqRow) return res.status(404).json({ error: "Talep bulunamadı." });
    if (reqRow.approver !== req.user.username) return res.status(403).json({ error: "Bu talebi onaylama yetkiniz yok." });
    if (reqRow.status !== "bekliyor") return res.status(409).json({ error: "Bu talep zaten karara bağlanmış." });
    if (reqRow.requested_by === req.user.username) {
      return res.status(409).json({ error: "Kimse kendi talebini onaylayamaz." });
    }

    const isTwoStepDelete = ["ann.delete", "training.close", "template.create", "template.update", "template.delete"].includes(reqRow.kind);
    const isFinalStep = !isTwoStepDelete || reqRow.step >= reqRow.total_steps;
    let secondStepApprover = null; // 2. adım açılırsa, transaction dışında bildirim göndermek için

    await withTransaction(async (client) => {
      const status = decision === "onayla" ? "onaylandi" : "reddedildi";
      await client.query(
        "UPDATE approval_requests SET status=$1, decision_reason=$2, decided_at=now() WHERE id=$3",
        [status, reason || null, reqRow.id]
      );

      if (reqRow.kind === "ann.publish") {
        const newStatus = decision === "onayla" ? "yayinda" : "geri_cekildi";
        await client.query("UPDATE announcements SET status=$1 WHERE id=$2", [newStatus, reqRow.target_id]);
        return;
      }

      if (reqRow.kind === "admin.action") {
        // Admin panelindeki her yazma işlemi buradan geçer: reddedilirse hiçbir şey
        // uygulanmaz (talep zaten hiçbir zaman veritabanını değiştirmemişti).
        // Onaylanırsa gerçek değişiklik burada, onay kaydından HEMEN SONRA uygulanır.
        return;
      }

      if (isTwoStepDelete) {
        if (decision !== "onayla") return; // reddedilirse hiçbir şey değişmez, kayıt "yayinda" kalır.
        if (!isFinalStep) {
          // 1. adım (yönetici) onaylandı: 2. adımı (Teftiş) aç.
          const insp = await client.query(
            "SELECT username FROM users WHERE role='inspection' AND active AND username NOT IN ($1,$2) ORDER BY username LIMIT 1",
            [reqRow.requested_by, req.user.username]
          );
          // Talebi açan zaten Teftiş'ten değilse kendisi de onaycı olabilir (görevler ayrılığı
          // yalnızca "kendi talebini onaylayamaz" ile korunur); bulunamazsa herhangi bir Teftiş kullanılır.
          const insp2 = insp.rowCount ? insp.rows[0] :
            (await client.query(
              "SELECT username FROM users WHERE role='inspection' AND active AND username != $1 ORDER BY username LIMIT 1",
              [reqRow.requested_by]
            )).rows[0];
          if (!insp2) throw new Error("Tanımlı bir Teftiş kullanıcısı kalmadı, ikinci onay adımı açılamadı.");
          await client.query(
            `INSERT INTO approval_requests (kind, subject, category, target_type, target_id, requested_by, approver, reason, payload, step, total_steps)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,2,2)`,
            [reqRow.kind, reqRow.subject, reqRow.category, reqRow.target_type, reqRow.target_id,
             reqRow.requested_by, insp2.username, reqRow.reason, reqRow.payload ? JSON.stringify(reqRow.payload) : null]
          );
          secondStepApprover = insp2.username;
        } else {
          // Son adım (Teftiş) onaylandı: GERÇEK etkiyi uygula — her zaman YUMUŞAK (soft).
          if (reqRow.kind === "ann.delete") {
            await client.query("UPDATE announcements SET status='silindi' WHERE id=$1", [reqRow.target_id]);
          } else if (reqRow.kind === "training.close") {
            await client.query(
              "UPDATE policy_documents SET status='kapali', closed_at=now(), closed_reason=$1 WHERE id=$2",
              [reqRow.reason, reqRow.target_id]
            );
            await client.query(
              "UPDATE training_assignments SET cancelled_at=now() WHERE policy_document_id=$1 AND completed_at IS NULL",
              [reqRow.target_id]
            );
          } else if (reqRow.kind === "template.create") {
            const p = reqRow.payload;
            await client.query(
              `INSERT INTO notification_templates (event_key, name, subject, body, created_by)
               VALUES ($1,$2,$3,$4,$5)`,
              [p.eventKey, p.name, p.subject, p.body, reqRow.requested_by]
            );
          } else if (reqRow.kind === "template.update") {
            const p = reqRow.payload;
            await client.query(
              `UPDATE notification_templates SET name=COALESCE($1,name), subject=COALESCE($2,subject),
                 body=COALESCE($3,body), status=COALESCE($4,status), updated_by=$5, updated_at=now() WHERE id=$6`,
              [p.name, p.subject, p.body, p.status, reqRow.requested_by, reqRow.target_id]
            );
          } else if (reqRow.kind === "template.delete") {
            // Yumuşak silme: satır kalır, durumu "kapali" olur (tıpkı diğer tüm silmeler gibi).
            await client.query(
              "UPDATE notification_templates SET status='kapali', updated_by=$1, updated_at=now() WHERE id=$2",
              [reqRow.requested_by, reqRow.target_id]
            );
          }
        }
      }
    });

    // admin.action onaylandıysa gerçek değişiklik burada, transaction'ın DIŞINDA uygulanır
    // (applyAdminAction kendi bağlantısını kullanır; onay kaydı zaten yukarıda kesinleşti).
    if (reqRow.kind === "admin.action" && decision === "onayla") {
      await applyAdminAction(reqRow.target_type, reqRow.payload, reqRow.requested_by);
    }
    // 2. adım (Teftiş) açıldıysa yeni onaycıya bildirim gider.
    if (secondStepApprover) {
      await notifyApprovalCreated({
        requestedBy: reqRow.requested_by, approver: secondStepApprover,
        subject: reqRow.subject, kind: reqRow.kind,
      });
    }

    const approvers = [req.user.username];
    const isDeleteKind = ["ann.delete", "training.close", "template.delete"].includes(reqRow.kind);
    await audit(
      `Talep ${decision === "onayla" ? "onaylandı" : "reddedildi"} (adım ${reqRow.step}/${reqRow.total_steps}): #${reqRow.id} ${reqRow.subject}`,
      req.user.username, decision === "onayla",
      { actionType: decision === "onayla" ? (isDeleteKind && isFinalStep ? "silme" : "onay") : "red",
        approvers }
    );
    // Bildirim ne zaman gider: tek adımlı taleplerde her zaman; iki adımlı
    // taleplerde REDDEDİLİRSE her zaman (süreç orada biter), ONAYLANIRSA
    // yalnızca SON adımda (ara onaylar henüz nihai karar değildir).
    if (isFinalStep || decision !== "onayla") {
      await notifyApprovalDecided({
        requestedBy: reqRow.requested_by, subject: reqRow.subject,
        decision, decisionReason: reason,
      });
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
