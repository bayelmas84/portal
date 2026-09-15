"use strict";
const { createApp } = require("./app");
const { config } = require("./config");
const { query } = require("./db");

const app = createApp();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[tera-portal] ${config.nodeEnv} modunda ${config.port} portunda dinliyor (auth: ${config.authMode})`);
});

// Süresi dolmuş oturumlar hiç silinmediği için `sessions` tablosu zamanla
// büyür (hijyen/performans sorunu — güvenlik açığı değil, zaten getSession()
// süresi dolmuş bir kaydı asla geçerli saymaz). Açılışta bir kez ve ardından
// her 6 saatte bir temizlenir.
async function cleanupExpiredSessions() {
  try {
    const { rowCount } = await query(
      "DELETE FROM sessions WHERE idle_expires_at < now() OR absolute_expires_at < now()"
    );
    if (rowCount) console.log(`[tera-portal] ${rowCount} süresi dolmuş oturum temizlendi.`);
  } catch (e) {
    console.error("[hata] oturum temizliği başarısız:", e.message);
  }
}
cleanupExpiredSessions();
setInterval(cleanupExpiredSessions, 6 * 60 * 60 * 1000);
