-- Proje yönetimi: projeler, iş kalemleri, sprintler ve burndown anlık görüntüleri.
-- Metrikler bu tablolardan hesaplanır; istemciye hazır hesaplanmış değer gönderilir.

CREATE TABLE IF NOT EXISTS projects (
  id           BIGSERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('Scrum','Kanban','Waterfall')) DEFAULT 'Scrum',
  lead         TEXT NOT NULL REFERENCES users(username),
  unit_code    TEXT REFERENCES units(code),
  status       TEXT NOT NULL CHECK (status IN ('planlama','devam','beklemede','tamamlandi','iptal')) DEFAULT 'devam',
  health       TEXT NOT NULL CHECK (health IN ('planinda','risk','gecikme')) DEFAULT 'planinda',
  start_date   DATE,
  target_date  DATE,
  budget_days  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sprints (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  goal         TEXT,
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  committed_points INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS sprint_proj_idx ON sprints(project_id);

CREATE TABLE IF NOT EXISTS project_items (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_key     TEXT NOT NULL UNIQUE,
  type         TEXT NOT NULL CHECK (type IN ('Epic','Story','Task','Bug')) DEFAULT 'Story',
  title        TEXT NOT NULL,
  state        TEXT NOT NULL CHECK (state IN ('backlog','todo','prog','review','test','done')) DEFAULT 'backlog',
  priority     TEXT NOT NULL CHECK (priority IN ('Highest','High','Medium','Low')) DEFAULT 'Medium',
  points       INTEGER NOT NULL DEFAULT 0,
  assignee     TEXT REFERENCES users(username),
  sprint_id    BIGINT REFERENCES sprints(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS item_proj_idx ON project_items(project_id, state);
CREATE INDEX IF NOT EXISTS item_sprint_idx ON project_items(sprint_id);

-- Günlük kalan iş anlık görüntüsü. Zamanlanmış görev (ops/burndown-job.js) her gün yazar.
CREATE TABLE IF NOT EXISTS burndown_snapshots (
  sprint_id    BIGINT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  remaining    INTEGER NOT NULL,
  completed    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sprint_id, day)
);

-- Faz kapıları (Waterfall): iki farklı kişiden, iki farklı rolden imza.
CREATE TABLE IF NOT EXISTS stage_gates (
  id           BIGSERIAL PRIMARY KEY,
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  criteria     JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_signatures INTEGER NOT NULL DEFAULT 2,
  passed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stage_gate_signatures (
  gate_id      BIGINT NOT NULL REFERENCES stage_gates(id) ON DELETE CASCADE,
  username     TEXT NOT NULL REFERENCES users(username),
  role_key     TEXT NOT NULL,
  signed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (gate_id, username)
);

-- Grup Direktörü ünvanı: yönetici özet raporlarına erişebilen kademelerden biri.
INSERT INTO titles (code, name, seniority) VALUES ('GDIR', 'Grup Direktörü', 'director')
  ON CONFLICT (code) DO NOTHING;
