-- 020_parametric_categories.sql
-- Kullanıcı isteği: duyuru kategorileri (Yasal/Genel sabitliği) tam parametrik
-- hale getirilsin. approval_rules tablosu genişletilerek TEK BİR "kategori
-- tanımı" tablosuna dönüştürülür: her kategori artık kendi kritiklik listesini
-- ve aktif/pasif durumunu da taşır. Admin panelinden YENİ kategori eklenebilir;
-- var olanın onaycısı/kritiklik listesi değiştirilebilir veya pasife alınabilir.
-- KASITLI SINIRLAMA: kategori adı DEĞİŞTİRİLEMEZ/SİLİNEMEZ (yalnızca pasife
-- alınabilir) — mevcut duyurular düz metin olarak eski adı taşımaya devam
-- eder, bu yüzden ad değişikliği/silme veri tutarlılığı riski taşır ve
-- kapsam dışı bırakılmıştır.
ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS criticalities TEXT NOT NULL DEFAULT 'Orta';
ALTER TABLE approval_rules ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

UPDATE approval_rules SET criticalities = 'Kritik,Yüksek' WHERE category = 'Yasal';
UPDATE approval_rules SET criticalities = 'Yüksek,Orta,Düşük' WHERE category = 'Genel';

-- Kritiklik listeleri artık kategori tanımının bir parçası (yukarıdaki
-- criticalities kolonu); eski genel ayarlar anahtarları kafa karışıklığına
-- yol açmaması için kaldırılır.
DELETE FROM app_settings WHERE key IN ('criticality_options_yasal', 'criticality_options_genel');
