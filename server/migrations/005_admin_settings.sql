-- 005_admin_settings.sql

-- Sırlar (SMTP/AD parolası) uygulama katmanında AES-256-GCM ile APP_ENCRYPTION_KEY
-- kullanılarak şifrelenir (bkz. server/src/lib/crypto.js); bu tabloda düz metin
-- parola hiçbir zaman tutulmaz.
CREATE TABLE IF NOT EXISTS smtp_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),   -- tek satır
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 587,
  from_addr TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  password_encrypted TEXT,
  tls BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT false,
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_msg TEXT,
  updated_by TEXT REFERENCES users(username),
  updated_at TIMESTAMPTZ
);
INSERT INTO smtp_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS directory_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url TEXT NOT NULL DEFAULT '',
  base_dn TEXT NOT NULL DEFAULT '',
  bind_dn TEXT NOT NULL DEFAULT '',
  bind_password_encrypted TEXT,
  user_filter TEXT NOT NULL DEFAULT '(&(objectClass=user)(sAMAccountName={username}))',
  tls BOOLEAN NOT NULL DEFAULT true,
  default_role TEXT NOT NULL DEFAULT 'staff',
  active BOOLEAN NOT NULL DEFAULT false,
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_msg TEXT,
  updated_by TEXT REFERENCES users(username),
  updated_at TIMESTAMPTZ
);
INSERT INTO directory_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS brand_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
