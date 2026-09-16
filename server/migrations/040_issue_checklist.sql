-- 040_issue_checklist.sql

-- Issue içinde basit bir kontrol listesi (Definition of Done benzeri):
-- Story Point/Estimate'ten ayrı, hızlı "bitmiş mi" göstergesi. Jira'nın
-- ağır "sub-task" mekanizmasından daha hafif bir alternatif.
CREATE TABLE IF NOT EXISTS project_issue_checklist_items (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  text TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_checklist_issue FOREIGN KEY (project_k, issue_key)
    REFERENCES project_issues(project_k, issue_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS project_issue_checklist_items_issue_idx
  ON project_issue_checklist_items(project_k, issue_key, position);
