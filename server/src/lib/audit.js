"use strict";
const { query } = require("../db");

async function audit(event, who, ok = true) {
  await query("INSERT INTO audit_log (event, who, ok) VALUES ($1,$2,$3)", [
    event,
    who || "sistem",
    ok,
  ]);
}

module.exports = { audit };
