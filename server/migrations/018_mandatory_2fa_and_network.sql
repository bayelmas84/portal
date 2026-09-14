-- 018_mandatory_2fa_and_network.sql
-- Admin ve Teftiş için 2FA ARTIK ZORUNLU (öneri değil). Bu roldeki bir
-- kullanıcı 2FA açmadan giriş yaparsa, oturumu "kurulum bekliyor" durumuna
-- alınır: yalnızca 2FA kurulum uçlarına erişebilir, başka hiçbir işlem
-- yapamaz ta ki 2FA'yı etkinleştirene kadar.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS must_setup_2fa BOOLEAN NOT NULL DEFAULT false;

-- Kullanıcının 2FA yöntemi: 'email' (varsayılan, basit) ya da 'app' (TOTP,
-- authenticator uygulaması). E-posta yöntemi authenticator app gerektirmez.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_method TEXT NOT NULL DEFAULT 'email'
  CHECK (totp_method IN ('email', 'app'));

UPDATE two_factor_policy SET required = true WHERE role IN ('admin', 'inspection');
