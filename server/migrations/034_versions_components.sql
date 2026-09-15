-- 034_versions_components.sql

-- Jira'daki "Fix Version" ve "Component" özellikleri: proje bazlı,
-- yönetilen (serbest metin değil) listeler. Konular bu listeden birden
-- fazla değer seçebilir (labels ile aynı desen: TEXT[] sütun, isimler
-- saklanır — silinen bir version/component, ona referans veren
-- konulardan uygulama katmanında otomatik temizlenir).

CREATE TABLE IF NOT EXISTS project_versions (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  release_date DATE,
  released BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_k, name)
);

CREATE TABLE IF NOT EXISTS project_components (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_assignee_username TEXT REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_k, name)
);

ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS fix_versions TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS components TEXT[] NOT NULL DEFAULT '{}';
