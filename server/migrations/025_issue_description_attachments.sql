-- 008_issue_description_attachments.sql

-- Konulara (issue) serbest metin açıklama alanı eklenir. Başlık (SUMMARY) kısa ve
-- eylem odaklı kalır; ayrıntılı bilgi bu alana yazılır.
ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Bir konuya (Epic/Story/Task/Bug) doküman eklenebilmesi icin ekler tablosu.
-- project_issues(project_k, issue_key) uzerindeki UNIQUE kisitina bileşik FK ile bağlanır.
CREATE TABLE IF NOT EXISTS project_issue_attachments (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  file_name TEXT NOT NULL,      -- kullanıcının gördüğü orijinal dosya adı
  stored_name TEXT NOT NULL,    -- diskte rastgele üretilmiş gerçek dosya adı
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(username),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_issue_attachment_issue FOREIGN KEY (project_k, issue_key)
    REFERENCES project_issues(project_k, issue_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS project_issue_attachments_issue_idx
  ON project_issue_attachments(project_k, issue_key);
