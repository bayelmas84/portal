-- E-posta ayarları Admin Panel'den yönetilir.
-- Parola AES-256-GCM ile şifreli saklanır; anahtar .env içindeki APP_ENCRYPTION_KEY'dir.
-- Tek satırlık tablodur (id = 1).
CREATE TABLE IF NOT EXISTS mail_settings (
  id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  host          TEXT,
  port          INTEGER NOT NULL DEFAULT 25,
  encryption    TEXT NOT NULL DEFAULT 'starttls' CHECK (encryption IN ('none','starttls','tls')),
  auth_user     TEXT,
  auth_pass_enc TEXT,                 -- şifreli; hiçbir uçtan geri dönmez
  from_address  TEXT,
  reply_to      TEXT,
  mail_domain   TEXT,
  group_inspection TEXT,
  group_all     TEXT,
  active        BOOLEAN NOT NULL DEFAULT FALSE,
  last_test_at  TIMESTAMPTZ,
  last_test_ok  BOOLEAN,
  last_test_error TEXT,
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO mail_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
