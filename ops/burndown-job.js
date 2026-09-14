#!/usr/bin/env node
"use strict";
// Aktif sprintler için günlük kalan iş anlık görüntüsü alır.
// Cron örneği: "55 23 * * * node /opt/tera-portal/ops/burndown-job.js"
const { load } = require("../server/src/config");
const db = require("../server/src/lib/db");
const projects = require("../server/src/lib/projects");

(async () => {
  const cfg = load(); db.init(cfg);
  const r = await projects.snapshotBurndown();
  console.log(`[${new Date().toISOString()}] burndown anlık görüntüsü: ${r.sprints} sprint, gün ${r.day}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
