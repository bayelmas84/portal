"use strict";
const { query } = require("../db");

// Geriye dönük uyumluluk: audit(event, who, ok) eskisi gibi çalışır.
// Yeni: audit(event, who, ok, { actionType, approvers: [a1,a2,a3] })
// actionType verilmezse olay metninden basit bir sınıflandırma yapılır.
function inferActionType(event) {
  const e = (event || "").toLowerCase();
  if (/reddedildi|red |reddet/.test(e)) return "red";
  if (/onayland|onay|imzaland/.test(e)) return "onay";
  if (/silindi|silme|kaldırıldı|kapat/.test(e)) return "silme";
  if (/güncellendi|değişti|değiştirildi|düzenlendi/.test(e)) return "düzenleme";
  if (/oluşturuldu|eklendi|yayınlandı|başlatıldı|girildi/.test(e)) return "ekleme";
  if (/giriş|çıkış|oturum/.test(e)) return "oturum";
  return "diğer";
}

async function audit(event, who, ok = true, meta = {}) {
  const actionType = meta.actionType || inferActionType(event);
  const approvers = meta.approvers || [];
  await query(
    "INSERT INTO audit_log (event, who, ok, action_type, approver1, approver2, approver3) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [event, who || "sistem", ok, actionType, approvers[0] || null, approvers[1] || null, approvers[2] || null]
  );
}

module.exports = { audit };
