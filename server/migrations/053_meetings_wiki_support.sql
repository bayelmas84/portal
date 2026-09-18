-- 053_meetings_wiki_support.sql
-- Wiki'den (proje bağımsız) oluşturulan toplantı notlarını desteklemek
-- için: bir toplantı artık ne bir projeye ne "Diğer" konuya bağlı
-- olmadan, yalnızca bir wiki sayfasına referansla var olabilir. Bu
-- durumda hiçbir Epic/Task açılmaz (bkz. projects.js POST /meetings) —
-- toplantı tamamen wiki içinde kalan, tek seferlik bir kayıttır.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS wiki_page_id INTEGER REFERENCES wiki_pages(id) ON DELETE SET NULL;

ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_check;
ALTER TABLE meetings ADD CONSTRAINT meetings_check
  CHECK (project_k IS NOT NULL OR project_other_subject IS NOT NULL OR wiki_page_id IS NOT NULL);
