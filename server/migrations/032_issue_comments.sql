-- 032_issue_comments.sql

-- Jira'daki gibi: her konu (issue) üzerinde bir yorum akışı. Yalnızca yazan
-- kişi kendi yorumunu düzenleyebilir/silebilir (moderasyon: pmdir/admin de
-- silebilir — uygulama katmanında kontrol edilir).
CREATE TABLE IF NOT EXISTS project_issue_comments (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  author_username TEXT NOT NULL REFERENCES users(username),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  CONSTRAINT fk_comment_issue FOREIGN KEY (project_k, issue_key)
    REFERENCES project_issues(project_k, issue_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS project_issue_comments_issue_idx
  ON project_issue_comments(project_k, issue_key, created_at);
