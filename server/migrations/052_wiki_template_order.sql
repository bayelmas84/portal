-- 052_wiki_template_order.sql
-- Kullanıcı isteği: "Proje ile ilgili kategorileri üstte göstermelisin."
-- Proje/PM odaklı şablonlar (Proje Analizi, Retrospective, SWOT, Risk
-- Kaydı, vb.) galeri listesinde en üstte, genel amaçlı şablonlar
-- (Toplantı Notu, Nasıl Yapılır, Doküman Kontrol Sayfası) altta
-- görünsün diye açık bir sıralama sütunu eklenir.
ALTER TABLE wiki_page_templates ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 100;

UPDATE wiki_page_templates SET sort_order = CASE name
  WHEN 'Proje Analizi' THEN 1
  WHEN 'Retrospective (4L)' THEN 2
  WHEN 'Proje Planı' THEN 3
  WHEN 'Proje Poster' THEN 4
  WHEN 'Proje Açılış (Kickoff) Toplantısı' THEN 5
  WHEN 'Proje Durum Raporu' THEN 6
  WHEN 'SWOT Analizi' THEN 7
  WHEN 'Risk Kaydı (Risk Register)' THEN 8
  WHEN 'Karar Kaydı (DACI)' THEN 9
  WHEN 'Ürün Gereksinimleri (PRD)' THEN 10
  WHEN 'Olay Sonrası İnceleme (Postmortem)' THEN 11
  WHEN '5 Neden Analizi (5 Whys)' THEN 12
  WHEN 'Beyin Fırtınası (Brainstorming)' THEN 13
  WHEN '1:1 Toplantısı' THEN 14
  WHEN 'Toplantı Notu' THEN 90
  WHEN 'Nasıl Yapılır (How-to)' THEN 91
  WHEN 'Karar Kaydı' THEN 92
  WHEN 'Doküman Kontrol Sayfası' THEN 93
  ELSE sort_order
END;
