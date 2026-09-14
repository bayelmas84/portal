-- 007_project_issues.sql

-- Kanban/Backlog/Sprint icin gercek konu (issue) takibi.
-- Hiyerarsi: Epic -> Story -> Task/Bug (Task ve Bug dogrudan Epic altina acilamaz).
CREATE TABLE IF NOT EXISTS project_issues (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  issue_key TEXT NOT NULL,             -- ornek: TRADE-1 (proje icinde essiz, sirali uretilir)
  issue_type TEXT NOT NULL CHECK (issue_type IN ('Epic','Story','Task','Bug')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog' CHECK (status IN ('backlog','todo','prog','review','test','done')),
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Highest','High','Medium','Low')),
  story_points INTEGER NOT NULL DEFAULT 0,
  assignee_username TEXT REFERENCES users(username),
  parent_key TEXT,                     -- ust konunun issue_key'i (ayni proje icinde)
  in_sprint BOOLEAN NOT NULL DEFAULT false, -- true ise projenin GUNCEL sprintindedir
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_k, issue_key)
);
CREATE INDEX IF NOT EXISTS project_issues_proj_idx ON project_issues(project_k, status);
CREATE INDEX IF NOT EXISTS project_issues_assignee_idx ON project_issues(assignee_username);

-- Guncel sprint bilgisi (tek aktif sprint varsayimi, projenin kendi sutunlarinda).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sprint_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sprint_goal TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sprint_ends_at DATE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sprint_number INTEGER NOT NULL DEFAULT 0;

-- Stage gate: kriterler ve imzalar JSONB olarak tutulur (basit, tek gate/proje).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gate_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gate_criteria JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gate_required INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gate_signoffs JSONB NOT NULL DEFAULT '[]'::jsonb;
