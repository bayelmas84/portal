-- 036_time_tracking.sql

-- Jira'daki gibi: Original Estimate / Remaining Estimate (dakika olarak,
-- proje içi tutarlı gösterim için) ve worklog (kim ne zaman ne kadar
-- çalıştı) kaydı.
ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS original_estimate_minutes INTEGER;
ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS remaining_estimate_minutes INTEGER;

CREATE TABLE IF NOT EXISTS project_issue_worklogs (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  author_username TEXT NOT NULL REFERENCES users(username),
  time_spent_minutes INTEGER NOT NULL CHECK (time_spent_minutes > 0),
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_worklog_issue FOREIGN KEY (project_k, issue_key)
    REFERENCES project_issues(project_k, issue_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS project_issue_worklogs_issue_idx ON project_issue_worklogs(project_k, issue_key, work_date);
