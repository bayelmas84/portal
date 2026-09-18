-- 047_custom_fields.sql
-- Proje bazlı özel alanlar: her proje kendi ek metadata alanlarını
-- tanımlayabilir (ör. "Müşteri Adı", "Bütçe Kodu"). Alan tanımı projeye
-- aittir; değerler her issue için ayrı saklanır.
CREATE TABLE IF NOT EXISTS project_custom_fields (
  id SERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','number','date','select')),
  select_options JSONB, -- yalnızca field_type='select' iken kullanılır: ["A","B","C"]
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_k, field_name)
);

CREATE TABLE IF NOT EXISTS issue_custom_values (
  field_id INTEGER NOT NULL REFERENCES project_custom_fields(id) ON DELETE CASCADE,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  value TEXT, -- tüm tipler metin olarak saklanır; frontend field_type'a göre yorumlar
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, issue_key)
);
CREATE INDEX IF NOT EXISTS issue_custom_values_issue_idx ON issue_custom_values(project_k, issue_key);
