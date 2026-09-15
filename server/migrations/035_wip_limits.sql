-- 035_wip_limits.sql

-- Jira'daki Kanban WIP (work-in-progress) limitleri: proje bazlı, her
-- durum sütunu (todo/prog/review/test) için opsiyonel bir maksimum konu
-- sayısı. "done" sütununa limit konmaz (Jira'da da konmaz). Basitlik
-- için tek bir JSONB sütunda tutulur: {"todo":5,"prog":3,...} — eksik
-- anahtar ya da null değer "limit yok" anlamına gelir.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS wip_limits JSONB NOT NULL DEFAULT '{}'::jsonb;
