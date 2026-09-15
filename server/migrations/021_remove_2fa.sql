-- 021_remove_2fa.sql
-- Kullanıcı kararı: 2FA özelliği tamamen kaldırıldı ("şimdilik böyle bir
-- özelliğe gerek yok"). Önceki migration'lar (016-018) geçmiş kaydı olarak
-- olduğu gibi bırakılır; bu migration eklediklerini geri alır.
ALTER TABLE users DROP COLUMN IF EXISTS totp_secret_encrypted;
ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled;
ALTER TABLE users DROP COLUMN IF EXISTS totp_method;

ALTER TABLE sessions DROP COLUMN IF EXISTS pending_2fa;
ALTER TABLE sessions DROP COLUMN IF EXISTS must_setup_2fa;
ALTER TABLE sessions DROP COLUMN IF EXISTS email_otp_code;
ALTER TABLE sessions DROP COLUMN IF EXISTS email_otp_expires_at;

DROP TABLE IF EXISTS two_factor_policy;
