#!/usr/bin/env node
"use strict";
/* Zorunlu okuma hatırlatmaları. Cron: 0 8 * * 1-5 node /opt/tera-portal/ops/reminder-job.js */
const { load } = require("../server/src/config");
const db = require("../server/src/lib/db");
const training = require("../server/src/lib/training");

(async () => {
  const cfg = load(); db.init(cfg);
  const r = await training.runReminders(cfg);
  console.log(`[${new Date().toISOString()}] kontrol: ${r.checked}, hatırlatma: ${r.reminded}, süre aşımı: ${r.escalated}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
