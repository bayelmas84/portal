"use strict";
const express = require("express");
const { query } = require("../db");
const { requireRead } = require("../middleware/auth");

const router = express.Router();

router.get("/", requireRead("c.audit"), async (req, res, next) => {
  try {
    const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
    const { rows } = await query(
      `SELECT a.id, a.event, a.who, a.ok, a.action_type, a.approver1, a.approver2, a.approver3, a.at,
        u.name AS who_name, u.unit AS who_unit_code, un.name AS who_unit_name,
        a1.name AS approver1_name, a2.name AS approver2_name, a3.name AS approver3_name
       FROM audit_log a
       LEFT JOIN users u ON u.username = a.who
       LEFT JOIN units un ON un.code = u.unit
       LEFT JOIN users a1 ON a1.username = a.approver1
       LEFT JOIN users a2 ON a2.username = a.approver2
       LEFT JOIN users a3 ON a3.username = a.approver3
       ORDER BY a.at DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ items: rows });
  } catch (e) {
    next(e);
  }
});

// CSV dışa aktarma: aynı sorgu, Excel'de doğrudan açılabilecek formatta.
// Sınır 5000 satır (dosya boyutu ve bellek için makul bir üst sınır).
function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
router.get("/export.csv", requireRead("c.audit"), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.at, a.event, a.who, u.name AS who_name, un.name AS who_unit_name,
        a.action_type, a.ok, a.approver1, a.approver2, a.approver3
       FROM audit_log a
       LEFT JOIN users u ON u.username = a.who
       LEFT JOIN units un ON un.code = u.unit
       ORDER BY a.at DESC
       LIMIT 5000`
    );
    const header = ["Tarih", "Olay", "Kullanıcı adı", "Ad Soyad", "Birim", "İşlem türü", "Başarılı", "Onaycı 1", "Onaycı 2", "Onaycı 3"];
    const lines = [header.map(csvEscape).join(",")];
    for (const r of rows) {
      lines.push([
        r.at ? new Date(r.at).toISOString() : "",
        r.event, r.who, r.who_name, r.who_unit_name, r.action_type,
        r.ok ? "evet" : "hayır", r.approver1 || "", r.approver2 || "", r.approver3 || "",
      ].map(csvEscape).join(","));
    }
    const csv = "\uFEFF" + lines.join("\r\n"); // BOM: Excel Türkçe karakterleri doğru okusun
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="denetim-kaydi-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
