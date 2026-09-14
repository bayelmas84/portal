-- 019_criticality_and_security_settings.sql
-- Kullanıcı isteği üzerine: kritiklik seviyeleri ve login deneme limiti de
-- artık app_settings üzerinden parametrik (admin onaylı). Kategori İSİMLERİ
-- (Yasal/Genel) sabit kalır çünkü onay kuralları matrisi ve backend
-- validasyonu bu isimlere bağımlıdır; değiştirilmesi ayrı, daha büyük bir
-- değişiklik gerektirir ve şu an kapsam dışıdır.
INSERT INTO app_settings (key, value) VALUES
  ('criticality_options_yasal', 'Kritik,Yüksek'),
  ('criticality_options_genel', 'Yüksek,Orta,Düşük'),
  ('login_max_attempts', '8')
ON CONFLICT (key) DO NOTHING;
