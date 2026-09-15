-- 026_issue_links.sql

-- Jira benzeri konu ilişkilendirmeleri: blocks, clones, duplicates, relates.
-- Tek bir yön (source->target) kaydedilir; ters yön (örn. "is blocked by")
-- uygulama katmanında source/target'ın hangi tarafta olduğuna bakılarak türetilir.
-- "relates" simetriktir (her iki tarafta da aynı etiketle görünür).
CREATE TABLE IF NOT EXISTS project_issue_links (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('blocks','clones','duplicates','relates')),
  source_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_link_source FOREIGN KEY (project_k, source_key)
    REFERENCES project_issues(project_k, issue_key) ON DELETE CASCADE,
  CONSTRAINT fk_link_target FOREIGN KEY (project_k, target_key)
    REFERENCES project_issues(project_k, issue_key) ON DELETE CASCADE,
  CONSTRAINT no_self_link CHECK (source_key <> target_key),
  UNIQUE (project_k, link_type, source_key, target_key)
);
CREATE INDEX IF NOT EXISTS project_issue_links_source_idx ON project_issue_links(project_k, source_key);
CREATE INDEX IF NOT EXISTS project_issue_links_target_idx ON project_issue_links(project_k, target_key);
