-- Active Directory bağlantı ayarları Admin Panel'den yönetilir.
-- Servis hesabı parolası AES-256-GCM ile şifreli saklanır (APP_ENCRYPTION_KEY).
CREATE TABLE IF NOT EXISTS directory_settings (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url               TEXT,
  base_dn           TEXT,
  bind_dn           TEXT,
  bind_password_enc TEXT,
  user_filter       TEXT NOT NULL DEFAULT '(&(objectClass=user)(sAMAccountName={username}))',
  tls_verify        BOOLEAN NOT NULL DEFAULT TRUE,
  auto_create_users BOOLEAN NOT NULL DEFAULT FALSE,
  default_role      TEXT NOT NULL DEFAULT 'staff',
  active            BOOLEAN NOT NULL DEFAULT FALSE,
  last_test_at      TIMESTAMPTZ,
  last_test_ok      BOOLEAN,
  last_test_error   TEXT,
  last_test_user    TEXT,
  updated_by        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO directory_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Tek kullanımlık BI devir anahtarları: aynı anahtarın tekrar kullanılması engellenir.
CREATE TABLE IF NOT EXISTS sso_nonces (
  nonce      TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  report_code TEXT NOT NULL,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sso_exp_idx ON sso_nonces(expires_at);

-- Hesap bazlı giriş kilidi: art arda hatalı denemede hesap geçici kilitlenir.
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- BI kataloğu yalnızca rapor değil, PRISMA modüllerini de tutabilir.
ALTER TABLE bi_reports ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'rapor';
