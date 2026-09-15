-- 023_drop_category_check_constraint.sql
-- Duyuru kategorileri tam parametrik hale getirildiğinde (approval_rules
-- tablosundan yönetiliyor) bu eski CHECK constraint'in (yalnızca 'Yasal' ve
-- 'Genel' değerlerine izin veren) hâlâ var olduğu fark edilmedi — admin
-- panelinden bir kategoriyi yeniden adlandırmaya çalışınca (announcements
-- tablosundaki eski kayıtları yeni ada taşıma denemesinde) bu constraint
-- ihlal hatası veriyordu. Artık kategori geçerliliği uygulama katmanında
-- (approval_rules tablosuna karşı) denetleniyor; DB seviyesinde sabit bir
-- kısıtlamaya gerek yok.
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_category_check;
