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

module.exports = router;
