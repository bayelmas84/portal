-- 027_issue_labels.sql

-- Konulara serbest metin etiketler (Jira "labels") eklenebilmesi için.
ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS project_issues_labels_idx ON project_issues USING GIN (labels);
