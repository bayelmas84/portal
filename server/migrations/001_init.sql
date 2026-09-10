-- Tera Portal — şema
-- Tüm zaman damgaları UTC'dir. Uygulama parametrik SQL dışında sorgu çalıştırmaz.

CREATE TABLE IF NOT EXISTS units (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS titles (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  seniority   TEXT NOT NULL DEFAULT 'specialist',
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS roles (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL
);

-- Yetki matrisi: rol x ekran -> read | write
CREATE TABLE IF NOT EXISTS role_permissions (
  role_key    TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  screen_key  TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('read','write')),
  PRIMARY KEY (role_key, screen_key)
);

-- Rolden bağımsız ekran durumu: acik | bakim | kapali
CREATE TABLE IF NOT EXISTS screen_state (
  screen_key  TEXT PRIMARY KEY,
  state       TEXT NOT NULL CHECK (state IN ('acik','bakim','kapali')) DEFAULT 'acik',
  changed_by  TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  username     TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email        TEXT,
  role_key     TEXT NOT NULL REFERENCES roles(key),
  unit_code    TEXT REFERENCES units(code),
  title_code   TEXT REFERENCES titles(code),
  manager      TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           TEXT,
  user_agent   TEXT,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(username);

CREATE TABLE IF NOT EXISTS announcements (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('Yasal','Genel')),
  criticality  TEXT NOT NULL CHECK (criticality IN ('Kritik','Yüksek','Orta','Düşük')),
  valid_until  DATE NOT NULL,
  popup        BOOLEAN NOT NULL DEFAULT FALSE,
  status       TEXT NOT NULL CHECK (status IN ('onayda','yayinda','reddedildi')) DEFAULT 'onayda',
  created_by   TEXT NOT NULL REFERENCES users(username),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ann_status_idx ON announcements(status);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  username        TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, username)
);

CREATE TABLE IF NOT EXISTS announcement_popup_dismissed (
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  username        TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  dismissed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, username)
);

CREATE TABLE IF NOT EXISTS documents (
  id            BIGSERIAL PRIMARY KEY,
  doc_no        TEXT NOT NULL,
  title         TEXT NOT NULL,
  version       TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('Yasal','Genel')),
  status        TEXT NOT NULL CHECK (status IN ('onayda','yayinda','reddedildi')) DEFAULT 'onayda',
  uploaded_by   TEXT NOT NULL REFERENCES users(username),
  file_name     TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  file_sha256   TEXT NOT NULL,
  page_count    INTEGER NOT NULL DEFAULT 1,
  effective_date DATE,
  reject_reason TEXT,
  pending_delete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_no, version)
);
CREATE INDEX IF NOT EXISTS doc_status_idx ON documents(status);

-- Okuma onayı sürüm bazlıdır: yeni sürüm önceki onayları geçersiz kılar.
CREATE TABLE IF NOT EXISTS document_acks (
  doc_no        TEXT NOT NULL,
  version       TEXT NOT NULL,
  username      TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  ack_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  seconds_spent INTEGER NOT NULL,
  PRIMARY KEY (doc_no, version, username)
);

-- Sunucu tarafı okuma oturumu: süre istemciye güvenilerek hesaplanmaz.
CREATE TABLE IF NOT EXISTS reading_sessions (
  id          TEXT PRIMARY KEY,
  username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  doc_id      BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  page_seconds JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_ping_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS reading_assignments (
  id           BIGSERIAL PRIMARY KEY,
  username     TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  doc_no       TEXT NOT NULL,
  due_date     DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  score        INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  escalated_at TIMESTAMPTZ,
  UNIQUE (username, doc_no)
);
CREATE INDEX IF NOT EXISTS ra_due_idx ON reading_assignments(due_date) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS quiz_questions (
  id          BIGSERIAL PRIMARY KEY,
  doc_no      TEXT NOT NULL,
  weight_band TEXT NOT NULL CHECK (weight_band IN ('critical','high','medium','low')),
  question    TEXT NOT NULL,
  options     JSONB NOT NULL,
  answer_index INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_doc_idx ON quiz_questions(doc_no);

CREATE TABLE IF NOT EXISTS requests (
  id             BIGSERIAL PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('ann.publish','ann.delete','doc.publish','doc.delete',
                                              'report.publish','report.retire')),
  subject        TEXT NOT NULL,
  category       TEXT,
  requested_by   TEXT NOT NULL REFERENCES users(username),
  approver       TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('bekliyor','onaylandi','reddedildi','geri_cekildi')) DEFAULT 'bekliyor',
  reason         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by     TEXT,
  decided_at     TIMESTAMPTZ,
  decision_reason TEXT
);
CREATE INDEX IF NOT EXISTS req_open_idx ON requests(approver, status);

-- Hash zincirli denetim kaydı. Uygulama yalnızca INSERT yapar.
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL PRIMARY KEY,
  event      TEXT NOT NULL,
  actor      TEXT NOT NULL,
  ok         BOOLEAN NOT NULL DEFAULT TRUE,
  detail     JSONB,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_defs (
  event_key  TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  to_req     BOOLEAN NOT NULL DEFAULT TRUE,
  to_mgr     BOOLEAN NOT NULL DEFAULT FALSE,
  to_appr    BOOLEAN NOT NULL DEFAULT FALSE,
  to_insp    BOOLEAN NOT NULL DEFAULT FALSE,
  to_all     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id         BIGSERIAL PRIMARY KEY,
  recipient  TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  event_key  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at    TIMESTAMPTZ,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS mail_pending_idx ON mail_outbox(sent_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS shortcuts (
  id      BIGSERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  url     TEXT NOT NULL,
  active  BOOLEAN NOT NULL DEFAULT TRUE,
  sort    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id        BIGSERIAL PRIMARY KEY,
  username  TEXT NOT NULL,
  ip        TEXT NOT NULL,
  ok        BOOLEAN NOT NULL,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(username, at);

-- Zincir başlığı ayrı tutulur: denetim kaydının tamamı silinse bile
-- satır sayısı ve son hash uyuşmazlığından anlaşılır.
CREATE TABLE IF NOT EXISTS audit_checkpoint (
  id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_hash   TEXT NOT NULL,
  entry_count BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
