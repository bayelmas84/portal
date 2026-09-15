"use strict";
require("dotenv").config();

function bool(v, def) {
  if (v === undefined || v === "") return def;
  return String(v).toLowerCase() === "true";
}

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  appUrl: process.env.APP_URL || "http://localhost:8080",
  trustProxy: bool(process.env.TRUST_PROXY, false),

  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "tera_portal",
    user: process.env.DB_USER || "tera_portal",
    password: process.env.DB_PASSWORD || "",
    ssl: bool(process.env.DB_SSL, false),
  },

  // 'ldap'  -> gerçek Active Directory (üretimde önerilir)
  // diğer her değer (varsayılan) -> yerel parola sistemi: her kullanıcının
  // admin tarafından belirlenmiş, argon2 ile hashlenmiş bir şifresi vardır;
  // şifresiz giriş YOKTUR (bkz. routes/auth.js getEffectiveAuthMode).
  // Admin Panel > Dizin (AD) Ayarları'ndaki anahtar bu değeri DB üzerinden
  // (yeniden başlatmaya gerek kalmadan) geçersiz kılabilir.
  authMode: process.env.AUTH_MODE || "local",

  session: {
    cookieName: process.env.SESSION_COOKIE || "tp_sid",
    idleMinutes: Number(process.env.SESSION_IDLE_MIN || 30),
    absoluteMinutes: Number(process.env.SESSION_ABSOLUTE_MIN || 600),
  },

  // 32 bayt base64: openssl rand -base64 32 — SMTP/AD parolalarını şifreler.
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY || "",

  loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS || 8),

  readingSecondsPerPage: Number(process.env.READING_SECONDS_PER_PAGE || 30),
  quizPassScore: Number(process.env.QUIZ_PASS_SCORE || 70),

  uploadDir: process.env.UPLOAD_DIR || "/var/lib/tera-portal/uploads",
  uploadMaxMb: Number(process.env.UPLOAD_MAX_MB || 25),

  // Kurumsal ağ (Tera domain) kısıtlaması: virgülle ayrılmış CIDR listesi
  // (örn. "10.20.0.0/16,192.168.50.0/24"). Boşsa kısıtlama uygulanmaz.
  networkAllowedCidrs: String(process.env.NETWORK_ALLOWED_CIDRS || "")
    .split(",").map((s) => s.trim()).filter(Boolean),
};

if (config.nodeEnv === "production" && config.authMode !== "ldap") {
  // eslint-disable-next-line no-console
  console.warn(
    "[config] UYARI: NODE_ENV=production ama AUTH_MODE=ldap değil. " +
      "Üretimde gerçek Active Directory kimlik doğrulaması zorunludur."
  );
}
if (config.nodeEnv === "production" && !config.appEncryptionKey) {
  throw new Error(
    "APP_ENCRYPTION_KEY tanımlı değil. Üretimde SMTP/AD parolaları şifrelenemez, başlatma durduruldu."
  );
}
// GÜVENLİK: üretimde tüm trafik HTTPS olmalı — düz HTTP asla kullanılmaz.
// (TLS sonlandırma Nginx'te yapılır; Node yalnızca localhost'ta HTTP dinler —
// bkz. KURULUM.md. Burada zorlanan, dışa açık APP_URL'in https:// olmasıdır.)
if (config.nodeEnv === "production" && !config.appUrl.startsWith("https://")) {
  throw new Error(
    "APP_URL https:// ile başlamalı. Üretimde düz HTTP kullanılamaz, başlatma durduruldu."
  );
}

module.exports = { config };
