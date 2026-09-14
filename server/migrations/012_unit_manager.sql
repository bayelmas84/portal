-- 012_unit_manager.sql

-- KURAL: her birimin mutlaka bir yoneticisi olmali. Kullanici olustururken
-- birim secilince yonetici bu alandan OTOMATIK alinir ve degistirilemez;
-- birimin yoneticisini degistirmek icin birim tanimi guncellenmelidir.
--
-- NOT: units.manager_username -> users.username VE users.unit -> units.code
-- birbirine bagli iki FK olusturuyor (dairesel bagimlilik). Bu yuzden DB
-- seviyesinde NOT NULL constraint KOYMUYORUZ (seed/kurulum sirasinda once
-- birimi, sonra kullaniciyi eklemek gerekebilir); zorunluluk UYGULAMA
-- seviyesinde (admin.js route validasyonu) saglanir.
ALTER TABLE units ADD COLUMN IF NOT EXISTS manager_username TEXT REFERENCES users(username);
