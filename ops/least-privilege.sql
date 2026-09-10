-- Uygulama veritabanı hesabının yetkileri en aza indirilir.
-- Kurulumda şemayı ayrı bir sahip hesap oluşturur; uygulama hesabı DDL yapamaz.
-- KURULUM.md bölüm 4'te bu betiğin nasıl çalıştırılacağı anlatılır.
--
-- Kullanım (postgres süper kullanıcısıyla, tera_portal veritabanına bağlıyken):
--   \i /opt/tera-portal/ops/least-privilege.sql

-- 1) Şema sahibi ayrı hesaptır; göçler bu hesapla çalıştırılır.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tera_portal_owner') THEN
    RAISE NOTICE 'tera_portal_owner rolü yok; önce oluşturun: CREATE USER tera_portal_owner WITH PASSWORD ...';
  END IF;
END $$;

-- 2) Uygulama hesabı şema üzerinde nesne oluşturamaz.
REVOKE CREATE ON SCHEMA public FROM tera_portal;
GRANT USAGE ON SCHEMA public TO tera_portal;

-- 3) Yalnızca veri işlemleri. TRUNCATE, DROP ve ALTER verilmez.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tera_portal;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tera_portal;

-- 4) Denetim kaydı yalnızca eklenebilir: güncelleme ve silme yetkisi verilmez.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM tera_portal;
GRANT SELECT, INSERT ON audit_log TO tera_portal;

-- 5) Zincir başlığı yalnızca artırılabilir; silinemez.
REVOKE DELETE, TRUNCATE ON audit_checkpoint FROM tera_portal;
GRANT SELECT, INSERT, UPDATE ON audit_checkpoint TO tera_portal;

-- 6) Göç tablosuna uygulama hesabı yazmaz (göçler sahip hesapla çalışır).
REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM tera_portal;
GRANT SELECT ON schema_migrations TO tera_portal;

-- 7) Bundan sonra oluşturulacak tablolar için de aynı varsayılanlar geçerli olsun.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tera_portal;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO tera_portal;

-- Doğrulama: aşağıdaki sorgu uygulama hesabının tablo yetkilerini listeler.
--   SELECT table_name, privilege_type FROM information_schema.table_privileges
--    WHERE grantee = 'tera_portal' ORDER BY table_name, privilege_type;
