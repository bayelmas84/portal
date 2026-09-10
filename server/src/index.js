"use strict";
const { load } = require("./config");
const db = require("./lib/db");
const { build } = require("./app");

const cfg = load();
db.init(cfg);

/* Güvensiz taşıma uyarıları: engellenmez ama sessiz de geçilmez. */
if (cfg.NODE_ENV === "production") {
  if (cfg.DB_SSL !== "true" && cfg.DB_HOST !== "127.0.0.1" && cfg.DB_HOST !== "localhost")
    console.warn("UYARI: Veritabanı uzak sunucuda ve DB_SSL kapalı. TLS açılmalı.");
  if (cfg.SMTP_HOST && Number(cfg.SMTP_PORT || 25) === 25)
    console.warn("UYARI: .env yedek SMTP ayarı şifrelemesiz 25. portu kullanıyor. Admin Panel'den STARTTLS önerilir.");
}
const app = build(cfg);
const server = app.listen(cfg.PORT, "127.0.0.1", () => {
  console.log(`Tera Portal ${cfg.NODE_ENV} modunda 127.0.0.1:${cfg.PORT} üzerinde çalışıyor`);
});
function shutdown(sig) {
  console.log(`${sig} alındı, kapanıyor...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
["SIGTERM", "SIGINT"].forEach((s) => process.on(s, () => shutdown(s)));
process.on("unhandledRejection", (e) => { console.error("unhandledRejection", e); shutdown("unhandledRejection"); });
