-- 028_meeting_items_and_due_dates.sql

-- Konulara (Task/Epic/Story/Bug) bitiş tarihi eklenir.
ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS due_date DATE;

-- Toplantı gündem maddelerine atanan kişi (zorunlu, uygulama katmanında
-- doğrulanır) ve bitiş tarihi (opsiyonel) eklenir. Ayrıca bu maddeden
-- otomatik oluşturulan Task konusunun anahtarı izlenebilirlik için saklanır.
ALTER TABLE meeting_items ADD COLUMN IF NOT EXISTS assignee_username TEXT REFERENCES users(username);
ALTER TABLE meeting_items ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE meeting_items ADD COLUMN IF NOT EXISTS linked_issue_key TEXT;
