-- 008_sprint_history.sql

-- Kapanan her sprintin sonucu (velocity raporu icin) burada kalıcı olarak tutulur.
-- Sprint kapatılırken projects tablosundaki sprint_* alanları sıfırlanır/degisir,
-- bu yuzden gecmis veriyi ayrı saklamak gerekir.
CREATE TABLE IF NOT EXISTS sprint_history (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  sprint_number INTEGER NOT NULL,
  sprint_name TEXT NOT NULL,
  sprint_goal TEXT,
  committed_points INTEGER NOT NULL DEFAULT 0,
  done_points INTEGER NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  done_count INTEGER NOT NULL DEFAULT 0,
  carried_over_count INTEGER NOT NULL DEFAULT 0,
  closed_by TEXT REFERENCES users(username),
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sprint_history_proj_idx ON sprint_history(project_k, sprint_number);
