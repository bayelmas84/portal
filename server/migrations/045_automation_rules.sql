-- 045_automation_rules.sql
-- Otomasyon kuralları: proje bazlı "tetikleyici -> koşul(lar) -> eylem(ler)"
-- kuralları. Jira'nın "Automation" özelliğinin küçültülmemiş (tam mantıklı)
-- ama bu uygulamanın kapsamına uyarlanmış bir versiyonu.
--
-- trigger_type: 'issue_created' | 'status_changed' | 'priority_changed'
-- trigger_value: status_changed için hedef status (ör. 'done'), priority_changed
--   için hedef priority (ör. 'High'); issue_created için kullanılmaz (NULL).
--   NULL ise "herhangi bir hedefe" geçişte tetiklenir.
-- conditions_json: [{field, op, value}, ...] — field: type|priority|status|assignee
--   op: eq|empty|not_empty
-- actions_json: [{type, value?, message?}, ...] — type: set_priority|set_status|
--   set_assignee|notify_assignee|notify_watchers|add_comment
CREATE TABLE IF NOT EXISTS automation_rules (
  id SERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('issue_created','status_changed','priority_changed')),
  trigger_value TEXT,
  conditions_json JSONB NOT NULL DEFAULT '[]',
  actions_json JSONB NOT NULL DEFAULT '[]',
  created_by TEXT REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_rules_project ON automation_rules(project_k, trigger_type, enabled);

-- Hangi kuralın hangi konuda ne zaman ne yaptığının izlenebilir kaydı —
-- otomatik eylemler görünmez olursa kafa karıştırır, bu tablo şeffaflık
-- sağlar (ekranda "Automation Rules" diyaloğunda "Son çalışmalar" olarak
-- gösterilir).
CREATE TABLE IF NOT EXISTS automation_log (
  id SERIAL PRIMARY KEY,
  rule_id INTEGER REFERENCES automation_rules(id) ON DELETE CASCADE,
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  fired_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_log_project ON automation_log(project_k, fired_at DESC);

-- Otomasyon bildirimlerinin de zil menüsünde görünebilmesi için yeni bir
-- in_app_notifications.kind değeri ekleniyor.
ALTER TABLE in_app_notifications DROP CONSTRAINT IF EXISTS in_app_notifications_kind_check;
ALTER TABLE in_app_notifications ADD CONSTRAINT in_app_notifications_kind_check
  CHECK (kind = ANY (ARRAY['comment','mention','assignment','automation']));
