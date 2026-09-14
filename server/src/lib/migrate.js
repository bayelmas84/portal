"use strict";
const fs = require("fs");
const path = require("path");
const { load } = require("../config");
const db = require("./db");

async function run(cfg = load()) {
  require("./audit").setKey(cfg);
  /* Göç, tanımlıysa şema sahibi hesapla çalışır: uygulama hesabının DDL yetkisi olmasına gerek kalmaz. */
  const owner = cfg.MIGRATION_DB_USER
    ? { ...cfg, DB_USER: cfg.MIGRATION_DB_USER, DB_PASSWORD: cfg.MIGRATION_DB_PASSWORD || cfg.DB_PASSWORD }
    : cfg;
  if (cfg.MIGRATION_DB_USER) console.log(`Göç hesabı: ${cfg.MIGRATION_DB_USER}`);
  db.init(owner);
  const dir = path.join(__dirname, "../../migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (file TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  for (const f of files) {
    const done = await db.one("SELECT file FROM schema_migrations WHERE file=$1", [f]);
    if (done) { console.log("atlandı:", f); continue; }
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await db.client().query(sql);
    await db.query("INSERT INTO schema_migrations (file) VALUES ($1)", [f]);
    console.log("uygulandı:", f);
  }
  console.log("Göç tamamlandı.");
}
if (require.main === module) run().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { run };
