"use strict";
require("dotenv").config();
const { z } = require("zod");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  APP_URL: z.string().url().default("https://portal.terayatirim.local"),

  DB_HOST: z.string().min(1).default("127.0.0.1"),
  DB_PORT: z.coerce.number().int().default(5432),
  DB_NAME: z.string().min(1).default("tera_portal"),
  DB_USER: z.string().min(1).default("tera_portal"),
  DB_PASSWORD: z.string().min(1, "DB_PASSWORD zorunlu"),
  DB_SSL: z.enum(["true", "false"]).default("false"),

  LDAP_URL: z.string().min(1).default("ldaps://dc01.tera.local:636"),
  LDAP_BASE_DN: z.string().min(1).default("DC=tera,DC=local"),
  LDAP_BIND_DN: z.string().min(1, "LDAP_BIND_DN zorunlu"),
  LDAP_BIND_PASSWORD: z.string().min(1, "LDAP_BIND_PASSWORD zorunlu"),
  LDAP_USER_FILTER: z.string().default("(&(objectClass=user)(sAMAccountName={username}))"),
  LDAP_TLS_REJECT_UNAUTHORIZED: z.enum(["true", "false"]).default("true"),

  SESSION_COOKIE: z.string().default("tp_sid"),
  SESSION_IDLE_MIN: z.coerce.number().int().min(5).max(480).default(30),
  SESSION_ABSOLUTE_MIN: z.coerce.number().int().min(30).max(1440).default(600),
  CSRF_SECRET: z.string().min(32, "CSRF_SECRET en az 32 karakter olmalı"),
  /* Veritabanında saklanan sırların (SMTP parolası) şifreleme anahtarı: 32 bayt base64 */
  APP_ENCRYPTION_KEY: z.string().refine(
    (v) => Buffer.from(v, "base64").length === 32,
    "APP_ENCRYPTION_KEY 32 bayt base64 olmalı: openssl rand -base64 32"),

  UPLOAD_DIR: z.string().default("/var/lib/tera-portal/uploads"),
  UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(100).default(25),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  MAIL_FROM: z.string().default("portal@terayatirim.com.tr"),
  MAIL_GROUP_INSPECTION: z.string().default("teftis-kurulu@terayatirim.com.tr"),
  MAIL_GROUP_ALL: z.string().default("tum-personel@terayatirim.com.tr"),
  MAIL_DOMAIN: z.string().default("terayatirim.com.tr"),

  /* BI servisi (PRISMA). Rapor motoru ayrı çalışır; portal kimlik devreder. */
  BI_BASE_URL: z.string().optional(),

  READING_SECONDS_PER_PAGE: z.coerce.number().int().min(5).default(30),
  READING_DUE_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /* Göçler ayrı, şema sahibi hesapla çalıştırılır; uygulama bu hesabı kullanmaz. */
  MIGRATION_DB_USER: z.string().optional(),
  MIGRATION_DB_PASSWORD: z.string().optional(),
  QUIZ_PASS_SCORE: z.coerce.number().int().min(1).max(100).default(70),
  TRUST_PROXY: z.enum(["true", "false"]).default("true"),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
});

function load(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const list = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error("Yapılandırma hatalı:\n" + list);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    if (c.LDAP_TLS_REJECT_UNAUTHORIZED === "false")
      throw new Error("Üretimde LDAP_TLS_REJECT_UNAUTHORIZED=false olamaz.");
    if (!c.LDAP_URL.startsWith("ldaps://"))
      throw new Error("Üretimde LDAP bağlantısı ldaps:// olmalıdır.");
    if (!c.APP_URL.startsWith("https://"))
      throw new Error("Üretimde APP_URL https:// olmalıdır.");
    if (c.APP_ENCRYPTION_KEY === c.CSRF_SECRET)
      throw new Error("APP_ENCRYPTION_KEY ile CSRF_SECRET aynı olamaz.");
    if (c.BI_BASE_URL && !c.BI_BASE_URL.startsWith("https://"))
      throw new Error("Üretimde BI_BASE_URL https:// olmalıdır.");
  }
  return c;
}

module.exports = { load, schema };
