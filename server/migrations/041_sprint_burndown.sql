-- 041_sprint_burndown.sql

-- Canlı backend'de günlük burndown grafiği için sprint'in GERÇEKTEN ne
-- zaman başladığını bilmemiz gerekiyor (bugüne kadar bu hiç tutulmuyordu,
-- yalnızca bitiş tarihi vardı). Mevcut açık sprint'ler için (geriye dönük
-- veri olmadığından) standart 2 haftalık bir sprint varsayımıyla bitiş
-- tarihinden 14 gün öncesi makul bir başlangıç tahmini olarak set edilir;
-- bundan sonra açılan her sprint gerçek başlangıç anını kaydedecek.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS sprint_started_at TIMESTAMPTZ;
UPDATE projects SET sprint_started_at = COALESCE(sprint_ends_at, CURRENT_DATE) - INTERVAL '14 days'
  WHERE sprint_name IS NOT NULL AND sprint_started_at IS NULL;
