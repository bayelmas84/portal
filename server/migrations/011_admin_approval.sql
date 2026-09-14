-- 011_admin_approval.sql

-- Admin panelindeki HER yazma işlemi (kullanıcı ekleme/düzenleme, dizin/SMTP/marka
-- ayarları, ekran yetkileri/erişimi) uygulanmadan önce işlemi yapan adminin
-- yöneticisi tarafından onaylanmalıdır. Onaylanana kadar hiçbir değişiklik
-- veritabanına yazılmaz; talep içeriği burada JSON olarak beklemede tutulur.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS payload JSONB;
