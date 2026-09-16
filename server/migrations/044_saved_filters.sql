-- 044_saved_filters.sql
-- Kayıtlı filtreler: kullanıcının "All Issues" ekranında sık kullandığı
-- filtre kombinasyonlarını (proje + durum/tip/öncelik/atanan/metin arama)
-- adlandırıp kaydedip, tek tıkla tekrar uygulayabilmesi için.
CREATE TABLE IF NOT EXISTS saved_filters (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  project_k TEXT,
  filters_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saved_filters_username ON saved_filters(username);
