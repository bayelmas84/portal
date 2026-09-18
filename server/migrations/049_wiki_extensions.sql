-- 049_wiki_extensions.sql
-- Confluence tarzı üç ek yetenek:
-- 1) Wiki sayfalarının issue/ticket'lara link olarak eklenip oradan
--    geçiş yapılabilmesi.
-- 2) Sayfa şablonları (yeni sayfa oluşturulurken hazır bir metinle
--    başlanabilmesi).
-- 3) Sayfa bazlı görünürlük kısıtlaması (bir sayfa, space'in genel
--    okuma kuralından daha dar bir role listesine kısıtlanabilir).

CREATE TABLE IF NOT EXISTS issue_wiki_links (
  id SERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  wiki_page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_k, issue_key, wiki_page_id)
);
CREATE INDEX IF NOT EXISTS issue_wiki_links_issue_idx ON issue_wiki_links(project_k, issue_key);
CREATE INDEX IF NOT EXISTS issue_wiki_links_page_idx ON issue_wiki_links(wiki_page_id);

CREATE TABLE IF NOT EXISTS wiki_page_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(username), -- NULL = önceden tanımlı sistem şablonu
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO wiki_page_templates (name, content, created_by) VALUES
  ('Toplantı Notu', E'# Toplantı Notu\n\n**Tarih:** \n**Katılımcılar:** \n\n## Gündem\n- \n\n## Kararlar\n- \n\n## Aksiyon Maddeleri\n- [ ] ', NULL),
  ('Nasıl Yapılır (How-to)', E'# Nasıl Yapılır: \n\n## Ön koşullar\n- \n\n## Adımlar\n1. \n2. \n3. \n\n## Sorun Giderme\n- ', NULL),
  ('Karar Kaydı', E'# Karar Kaydı\n\n**Tarih:** \n**Karar Sahibi:** \n\n## Bağlam\n\n\n## Karar\n\n\n## Gerekçe\n', NULL)
ON CONFLICT (name) DO NOTHING;

-- Sayfa bazlı görünürlük kısıtlaması: bir satır varsa, o sayfayı yalnızca
-- listelenen roller (pm/pmdir düzenleme yetkisi her zaman ayrık kalır)
-- okuyabilir. Satır yoksa sayfa, space'in normal (herkese/proje ekibine
-- açık) kuralını miras alır — bu yüzden VARSAYILAN davranış değişmez.
CREATE TABLE IF NOT EXISTS wiki_page_restrictions (
  page_id INTEGER PRIMARY KEY REFERENCES wiki_pages(id) ON DELETE CASCADE,
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  updated_by TEXT NOT NULL REFERENCES users(username),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
