-- 022_local_password_auth.sql
-- Kullanıcı kararı: AD kapalıyken (mock/yerel mod) şifresiz giriş OLMASIN.
-- Admin her kullanıcı için AYRI bir ilk giriş şifresi belirler (sabit/ortak
-- bir varsayılan şifre YOKTUR — güvenlik açısından tercih edilmez). Kullanıcı
-- ilk girişte bu şifreyi DEĞİŞTİRMEK ZORUNDADIR (iki kez teyit ile). Bu andan
-- sonra admin panelinde şifrenin kendisi HİÇBİR ZAMAN görünmez/saklanmaz —
-- yalnızca "şifreyi sıfırla" eylemi vardır (kendiliğinden şifremi unuttum
-- akışı YOKTUR, kasıtlı olarak — kurumsal ortamda bunun yerine IT/admin
-- müdahalesi beklenir). AD aktifken bu sütunlar hiç kullanılmaz — parola
-- yaşam döngüsü AD'nin kendi sorumluluğundadır.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT true;

-- Şifre doğrulandı ama henüz değiştirilmedi: oturum bu ara durumda açılır,
-- yalnızca /api/auth/change-password ve /logout uçlarına erişebilir.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS force_password_change BOOLEAN NOT NULL DEFAULT false;
