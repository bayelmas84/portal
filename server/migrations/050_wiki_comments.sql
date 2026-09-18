-- 050_wiki_comments.sql
-- Wiki sayfalarına yorum + @etiketleme (issue yorumlarındaki AYNI mantık:
-- @kullaniciadi tespit edilir, etiketlenen kişiye bildirim gider).
CREATE TABLE IF NOT EXISTS wiki_page_comments (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  author_username TEXT NOT NULL REFERENCES users(username),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_page_comments_page_idx ON wiki_page_comments(page_id, created_at);

-- in_app_notifications tablosu şimdiye kadar yalnızca issue olaylarını
-- (project_k/issue_key ZORUNLU) taşıyordu. Wiki yorumu/etiketlenmesi bir
-- issue'ya ait olmadığı için bu iki sütun artık NULLABLE olmalı; yerine
-- ilgili wiki sayfasına işaret eden nullable bir sütun eklenir.
ALTER TABLE in_app_notifications ALTER COLUMN project_k DROP NOT NULL;
ALTER TABLE in_app_notifications ALTER COLUMN issue_key DROP NOT NULL;
ALTER TABLE in_app_notifications ADD COLUMN IF NOT EXISTS wiki_page_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE;
ALTER TABLE in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check
  CHECK (kind = ANY (ARRAY['comment','mention','assignment','automation','wiki_comment','wiki_mention']));

-- Temel konularda iki yeni sistem şablonu (kullanıcı isteği: "Proje
-- Yönetimi, Doküman Yönetimi gibi temel konularda" şablonlar olmalı).
INSERT INTO wiki_page_templates (name, content, created_by) VALUES
  ('Proje Planı', E'# Proje Planı: \n\n**Proje Yöneticisi:** \n**Başlangıç / Bitiş:** \n\n## Amaç ve Kapsam\n\n\n## Kilometre Taşları\n- [ ] \n\n## Riskler\n| Risk | Olasılık | Etki | Önlem |\n|---|---|---|---|\n| | | | |\n\n## Paydaşlar\n- ', NULL),
  ('Doküman Kontrol Sayfası', E'# Doküman Kontrol Sayfası\n\n**Doküman No:** \n**Versiyon:** \n**Sahip:** \n**Onay Tarihi:** \n**Gözden Geçirme Sıklığı:** \n\n## Amaç\n\n\n## Kapsam\n\n\n## Değişiklik Geçmişi\n| Versiyon | Tarih | Değişiklik | Yapan |\n|---|---|---|---|\n| | | | |', NULL)
ON CONFLICT (name) DO NOTHING;
