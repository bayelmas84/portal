-- 042_issue_watchers.sql
-- Bir konuyu (issue) izlemek isteyen kişiler — assignee/reporter/yorumcu
-- olmadan da bildirim almak isteyenler için. Jira'daki "Watch" özelliğinin
-- karşılığı.
CREATE TABLE IF NOT EXISTS project_issue_watchers (
  id SERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  username TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_k, issue_key, username)
);
CREATE INDEX IF NOT EXISTS issue_watchers_issue_idx ON project_issue_watchers(project_k, issue_key);
