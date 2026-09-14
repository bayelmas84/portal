-- 017_2fa_email_and_policy.sql
-- E-posta ile tek kullanımlık kod (TOTP'ye alternatif/ek doğrulama yöntemi):
-- bekleyen oturuma bağlı, kısa ömürlü, tek kullanımlık kod.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS email_otp_code TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS email_otp_expires_at TIMESTAMPTZ;

-- Rol bazlı 2FA politikası: hangi roller için 2FA zorunlu (öneri niteliğinde -
-- kullanıcı arayüzünde uyarı gösterilir, teknik olarak zorlanmaz; tam
-- zorunluluk mevcut oturum/onay akışlarını riske atmadan ayrı bir adımda
-- eklenebilir).
CREATE TABLE IF NOT EXISTS two_factor_policy (
  role TEXT PRIMARY KEY,
  required BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO two_factor_policy (role, required) VALUES
  ('admin', true), ('inspection', true)
ON CONFLICT (role) DO NOTHING;
