-- 016_two_factor_auth.sql
-- İki faktörlü kimlik doğrulama (TOTP, RFC 6238). Özellikle admin ve Teftiş
-- rolleri için önerilir ama herkes kendi hesabından açabilir/kapatabilir.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;

-- Oturum, şifre doğrulandıktan sonra ama 2FA kodu girilene kadar "beklemede"
-- kalır; bu haldeyken hiçbir korumalı uca erişim verilmez (attachUser bunu
-- req.user=null yaparak sağlar).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pending_2fa BOOLEAN NOT NULL DEFAULT false;
