"use strict";
const express = require("express");
const db = require("../lib/db");
const { requireScreen } = require("../middleware/auth");

module.exports = () => {
  const r = express.Router();

  /* Herkesin görebildiği salt-okunur kişi rehberi: gerçek users/units/titles
     tablolarından. Parola vb. hassas alan döndürülmez. */
  r.get("/", requireScreen("e.list"), async (req, res) => {
    const rows = await db.many(
      `SELECT u.username, u.display_name, u.email, u.unit_code, un.name AS unit_name,
              u.title_code, t.name AS title_name, u.manager, m.display_name AS manager_name
         FROM users u
         LEFT JOIN units un ON un.code = u.unit_code
         LEFT JOIN titles t ON t.code = u.title_code
         LEFT JOIN users m ON m.username = u.manager
        WHERE u.active = TRUE
        ORDER BY un.name NULLS LAST, u.display_name`);
    res.json({ items: rows });
  });

  return r;
};
