-- 001_init.sql — temel tablolar: kullanıcılar, oturum, denetim, ekran erişimi

CREATE TABLE IF NOT EXISTS units (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS titles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  unit TEXT REFERENCES units(code),
  title TEXT REFERENCES titles(code),
  manager_username TEXT REFERENCES users(username),
  color TEXT NOT NULL DEFAULT '#0B1F48',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Portal parola saklamaz: kimlik doğrulama Active Directory üzerinden yapılır
-- (bkz. server/src/auth/ldap.js). "mock" modda (DIRECTORY_AUTH_MODE=mock) geliştirme
-- ortamı için kullanıcı adı eşleşmesi yeterlidir; üretimde AUTH_MODE=ldap zorunludur.

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- rastgele 32 bayt, base64url (crypto.randomBytes)
  username TEXT NOT NULL REFERENCES users(username),
  csrf_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idle_expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_username_idx ON sessions(username);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  who TEXT NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT true,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ekran açık/bakımda/kapalı durumu (rolden bağımsız, global anahtar).
CREATE TABLE IF NOT EXISTS screen_availability (
  screen_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'acik' CHECK (status IN ('acik','bakim','kapali'))
);

-- Rol x ekran erişim matrisi ("none" satırı hiç eklenmez).
CREATE TABLE IF NOT EXISTS role_access (
  role TEXT NOT NULL,
  screen_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('read','write')),
  PRIMARY KEY (role, screen_key)
);

CREATE TABLE IF NOT EXISTS mail_log (
  id BIGSERIAL PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
