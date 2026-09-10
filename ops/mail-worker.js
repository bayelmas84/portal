#!/usr/bin/env node
"use strict";
// E-posta kuyruğunu boşaltır.
// Cron örneği: "*/5 * * * * node /opt/tera-portal/ops/mail-worker.js"
const { load } = require("../server/src/config");
const db = require("../server/src/lib/db");
const mailer = require("../server/src/lib/mailer");

(async () => {
  const cfg = load(); db.init(cfg);
  const r = await mailer.flush(cfg, Number(process.env.MAIL_BATCH || 50));
  console.log(`[${new Date().toISOString()}] gönderilen: ${r.sent}, başarısız: ${r.failed}, kuyrukta: ${r.pending}${r.note ? " (" + r.note + ")" : ""}`);
  process.exit(r.failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(1); });
