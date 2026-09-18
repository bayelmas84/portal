-- 048_wiki.sql
-- Confluence tarzı hafif bilgi tabanı: "Space" (alan) kapsayıcıları içinde
-- hiyerarşik sayfalar. Mevcut "Doküman Yönetimi" (6 adımlı onay zinciri)
-- resmi belgeler içindir; bu modül ekip notları/how-to/bilgi paylaşımı
-- gibi ONAY GEREKTİRMEYEN, hızlı düzenlenebilir içerik içindir.
--
-- İki space türü: project_k NULL olan tek bir "Genel" (şirket geneli)
-- space, ve her proje için project_k dolu bir space. Okuma: Genel space
-- herkese açık; proje space'i o projeyi görebilen herkese açık (d.board
-- read). Yazma: yalnızca pm/pmdir rolü (route içinde kontrol edilir,
-- ekran-bazlı R/W matrisine dahil edilmez — custom fields ile aynı model).
CREATE TABLE IF NOT EXISTS wiki_spaces (
  id SERIAL PRIMARY KEY,
  space_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  project_k TEXT REFERENCES projects(k),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO wiki_spaces (space_key, name, project_k)
  VALUES ('GENEL', 'Genel Bilgi Tabanı', NULL)
  ON CONFLICT (space_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS wiki_pages (
  id SERIAL PRIMARY KEY,
  space_id INTEGER NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES wiki_pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(username),
  updated_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_pages_space_idx ON wiki_pages(space_id, parent_id, sort_order);

-- Versiyon geçmişi: her güncellemede ESKİ hali burada saklanır (yeni hal
-- wiki_pages'te). Böylece "kim ne zaman ne yazmış" geriye dönük izlenebilir.
CREATE TABLE IF NOT EXISTS wiki_page_versions (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  edited_by TEXT NOT NULL REFERENCES users(username),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wiki_page_versions_page_idx ON wiki_page_versions(page_id, edited_at DESC);
