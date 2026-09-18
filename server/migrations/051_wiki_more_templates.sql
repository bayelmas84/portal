-- 051_wiki_more_templates.sql
-- Kullanıcı isteği: "Kapsamlı bir kontrol yap webde, Jira/diğer proje
-- yönetim uygulamalarında neler varsa ekle." Confluence'ın gerçek şablon
-- galerisi (Meeting Notes, Retrospective/4L's, 1:1, Project Poster,
-- Status Report, DACI Decision, Risk Register, Kickoff, PRD, Postmortem,
-- 5 Whys, Brainstorming, SWOT) araştırılarak, kurumsal bir portala uygun
-- Türkçe karşılıkları eklendi. "Toplantı Notu" ve "Retrospective Toplantı
-- Notu" ayrıca frontend'de YAPILANDIRILMIŞ bir form açar (tarih/katılımcı/
-- gündem) — bu şablonlar o formun içeriğini önceden doldurur.
INSERT INTO wiki_page_templates (name, content, created_by) VALUES
  ('Retrospective (4L)', E'# Retrospective\n\n**Sprint/Dönem:** \n**Tarih:** \n\n## Beğendiklerim (Loved)\n- \n\n## Öğrendiklerim (Learned)\n- \n\n## Eksik Kalanlar (Lacked)\n- \n\n## Özlediklerim (Longed for)\n- \n\n## Aksiyon Maddeleri\n- [ ] ', NULL),
  ('1:1 Toplantısı', E'# 1:1 Toplantısı\n\n**Katılımcılar:** \n**Tarih:** \n\n## Gündem\n- \n\n## Geri Bildirim\n\n\n## Kariyer/Gelişim Notları\n\n\n## Aksiyon Maddeleri\n- [ ] ', NULL),
  ('Proje Açılış (Kickoff) Toplantısı', E'# Proje Açılış Toplantısı\n\n**Proje:** \n**Tarih:** \n**Sponsor:** \n\n## Proje Amacı\n\n\n## Kapsam (Var / Yok)\n**Kapsamda:**\n- \n**Kapsam Dışı:**\n- \n\n## Ekip ve Roller\n| Rol | Kişi |\n|---|---|\n| | |\n\n## Zaman Çizelgesi\n\n\n## Başarı Kriterleri\n- ', NULL),
  ('Proje Poster', E'# Proje Poster\n\n**Proje Adı:** \n**Proje Yöneticisi:** \n\n## Neden Bu Proje?\n\n\n## Hedefler\n- \n\n## Kilometre Taşları\n| Tarih | Kilometre Taşı |\n|---|---|\n| | |\n\n## Ekip\n- \n\n## Riskler ve Varsayımlar\n- ', NULL),
  ('Proje Durum Raporu', E'# Proje Durum Raporu\n\n**Proje:** \n**Tarih:** \n**Genel Durum:** 🟢 Yolunda / 🟡 Riskli / 🔴 Sorunlu\n\n## Bu Dönem Tamamlananlar\n- \n\n## Sıradaki Adımlar\n- \n\n## Riskler / Engeller\n- \n\n## Bütçe / Zaman Durumu\n', NULL),
  ('Karar Kaydı (DACI)', E'# Karar Kaydı\n\n**Konu:** \n**Tarih:** \n\n## DACI\n**Driver (Sürükleyici):** \n**Approver (Onaylayan):** \n**Contributors (Katkı Sağlayanlar):** \n**Informed (Bilgilendirilenler):** \n\n## Bağlam\n\n\n## Değerlendirilen Seçenekler\n- \n\n## Alınan Karar\n\n\n## Gerekçe\n', NULL),
  ('Risk Kaydı (Risk Register)', E'# Risk Kaydı\n\n**Proje:** \n**Güncelleme Tarihi:** \n\n| # | Risk | Olasılık | Etki | Önlem | Sahibi | Durum |\n|---|---|---|---|---|---|---|\n| 1 | | | | | | Açık |\n', NULL),
  ('Ürün Gereksinimleri (PRD)', E'# Ürün Gereksinimleri Dokümanı\n\n**Özellik/Ürün:** \n**Sahip:** \n**Durum:** Taslak\n\n## Problem Tanımı\n\n\n## Hedef Kullanıcı\n\n\n## Gereksinimler\n- [ ] \n\n## Kabul Kriterleri\n- \n\n## Kapsam Dışı\n- ', NULL),
  ('Olay Sonrası İnceleme (Postmortem)', E'# Olay Sonrası İnceleme (Postmortem)\n\n**Olay Tarihi:** \n**Etki Süresi:** \n**Ciddiyet:** \n\n## Özet\n\n\n## Zaman Çizelgesi\n| Saat | Olay |\n|---|---|\n| | |\n\n## Kök Neden\n\n\n## Etkilenen Sistemler/Kullanıcılar\n\n\n## Alınan Aksiyonlar\n- [ ] \n\n## Öğrenilen Dersler (suçlamasız)\n- ', NULL),
  ('5 Neden Analizi (5 Whys)', E'# 5 Neden Analizi\n\n**Problem:** \n\n1. Neden? \n2. Neden? \n3. Neden? \n4. Neden? \n5. Neden? \n\n## Kök Neden\n\n\n## Önerilen Aksiyon\n', NULL),
  ('Beyin Fırtınası (Brainstorming)', E'# Beyin Fırtınası\n\n**Konu/Problem:** \n**Katılımcılar:** \n\n## Fikirler\n- \n\n## Gruplama / Temalar\n\n\n## Oylama Sonucu (öncelikli fikirler)\n1. \n2. \n3. \n\n## Sonraki Adımlar\n- [ ] ', NULL),
  ('SWOT Analizi', E'# SWOT Analizi\n\n**Konu:** \n\n## Güçlü Yönler (Strengths)\n- \n\n## Zayıf Yönler (Weaknesses)\n- \n\n## Fırsatlar (Opportunities)\n- \n\n## Tehditler (Threats)\n- \n\n## Sonuç ve Öneriler\n', NULL),
  ('Proje Analizi', E'# Proje Analizi\n\n**Proje:** \n**Analiz Tarihi:** \n**Analiz Eden:** \n\n## Mevcut Durum Özeti\n\n\n## Kapsam ve Hedeflere Uygunluk\n\n\n## Zaman Çizelgesi Değerlendirmesi\n\n\n## Bütçe Değerlendirmesi\n\n\n## Riskler ve Sorunlar\n| Risk/Sorun | Etki | Öneri |\n|---|---|---|\n| | | |\n\n## Genel Değerlendirme ve Tavsiyeler\n', NULL)
ON CONFLICT (name) DO NOTHING;
