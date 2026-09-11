-- Değişiklik talepleri (d.cr). CHANGELOG 1.8.0: "talep sahibinin yöneticisi ve
-- proje ekibi onayı birlikte zorunlu" — iki bağımsız onay, sırasız, ikisi de
-- gerekli. "Proje ekibi onayı" projenin PM/PMD'si tarafından temsilen verilir.
--
-- Not: Onaycılar günlüğü (d.appr) için ayrı bir tablo YOK — mevcut
-- stage_gate_signatures ve project_document_approvals tabloları zaten bu
-- bilgiyi tutuyor; d.appr ekranı bunları birleştiren salt-okunur bir sorgudur
-- (server/src/lib/projectDocs.js'e yakın, routes/projects.js'teki
-- GET /:id/approvals-log ucunda).

CREATE TABLE IF NOT EXISTS project_change_requests (
  id                  BIGSERIAL PRIMARY KEY,
  project_id          BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  requested_by        TEXT NOT NULL REFERENCES users(username),
  status              TEXT NOT NULL CHECK (status IN ('bekliyor','onaylandi','reddedildi')) DEFAULT 'bekliyor',
  manager_approved_by TEXT REFERENCES users(username),
  manager_approved_at TIMESTAMPTZ,
  team_approved_by    TEXT REFERENCES users(username),
  team_approved_at    TIMESTAMPTZ,
  reject_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS project_cr_project_idx ON project_change_requests(project_id, status);
