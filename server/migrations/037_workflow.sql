-- 037_workflow.sql

-- Yapılandırılabilir iş akışı: durum KÜMESİ sabit kalır
-- (backlog/todo/prog/review/test/done — Board/WIP/Sprint/Roadmap gibi
-- tüm ekranlar buna bağlı), ama proje bazında hangi geçişlerin kimler
-- tarafından yapılabileceği özelleştirilebilir.
--
-- ÖNEMLİ TASARIM KARARI: bu tablo bir "izin listesi" değil, bir
-- "KISITLAMA listesi"dir. Bir (from,to) çifti için satır YOKSA o geçiş
-- serbesttir (bugünkü davranışla birebir geriye dönük uyumluluk —
-- backend bugüne kadar hiçbir geçiş kısıtı uygulamıyordu, örn. toplantı
-- senkronizasyonu bir Task'ı doğrudan backlog->done yapabiliyor).
-- Satır VARSA: enabled=false ise kimse yapamaz (pmdir/admin hariç);
-- allowed_roles doluysa yalnızca o roller (+ pmdir/admin) yapabilir.
CREATE TABLE IF NOT EXISTS project_workflow_transitions (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  from_status TEXT NOT NULL CHECK (from_status IN ('backlog','todo','prog','review','test','done')),
  to_status TEXT NOT NULL CHECK (to_status IN ('backlog','todo','prog','review','test','done')),
  allowed_roles TEXT[] NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (project_k, from_status, to_status)
);

-- Mevcut tüm projelere, bugüne kadar frontend'de sabit kodlu olan
-- NEXT[] zincirini birebir varsayılan (kısıtlamasız: allowed_roles={},
-- enabled=true) olarak ata — hiçbir mevcut davranış değişmez.
INSERT INTO project_workflow_transitions (project_k, from_status, to_status)
SELECT k, f, t FROM projects,
  (VALUES ('backlog','todo'),('todo','prog'),('prog','review'),('prog','todo'),
          ('review','test'),('review','prog'),('test','done'),('test','prog'),
          ('done','prog')) AS defaults(f, t)
ON CONFLICT (project_k, from_status, to_status) DO NOTHING;
