-- 033_issue_rank.sql

-- Jira'daki "Rank" özelliği: Backlog'da sürükle-bırak ile serbest
-- önceliklendirme sırası. Kesirli (fractional) sıralama tekniği:
-- iki komşu arasına eklenirken ortanca değer alınır, uçlara eklenirken
-- ±1000 kaydırılır — mevcut hiçbir kaydın rank'ı yeniden hesaplanmaz.
ALTER TABLE project_issues ADD COLUMN IF NOT EXISTS rank DOUBLE PRECISION;
UPDATE project_issues SET rank = id * 1000 WHERE rank IS NULL;
ALTER TABLE project_issues ALTER COLUMN rank SET NOT NULL;
ALTER TABLE project_issues ALTER COLUMN rank SET DEFAULT 0;
CREATE INDEX IF NOT EXISTS project_issues_rank_idx ON project_issues(project_k, rank);
