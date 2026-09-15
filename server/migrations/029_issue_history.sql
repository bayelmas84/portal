-- 029_issue_history.sql

-- Bir konu üzerinde yapılan her değişikliğin (durum, öncelik, atanan kişi,
-- bitiş tarihi, etiketler, ilişkiler, dokümanlar) kim tarafından ne zaman
-- yapıldığını konunun kendi detay ekranında gösterebilmek için.
CREATE TABLE IF NOT EXISTS project_issue_history (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  username TEXT NOT NULL REFERENCES users(username),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_history_issue FOREIGN KEY (project_k, issue_key)
    REFERENCES project_issues(project_k, issue_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS project_issue_history_issue_idx ON project_issue_history(project_k, issue_key);
