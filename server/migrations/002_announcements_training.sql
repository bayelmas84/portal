-- 002_announcements_training.sql

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Yasal','Genel')),
  criticality TEXT NOT NULL,
  valid_until DATE,
  popup BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'onayda' CHECK (status IN ('onayda','yayinda','geri_cekildi')),
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  username TEXT NOT NULL REFERENCES users(username),
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, username)
);

-- Genel akış: onaylanacak/reddedilecek her kayıt (duyuru yayını, duyuru silme,
-- doküman sürümü vb.) burada tek tipte tutulur; yalnızca giren, onun yöneticisi
-- ve onaycı (Yasal -> Teftiş, Genel -> yönetici) görür.
CREATE TABLE IF NOT EXISTS approval_requests (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,                 -- 'ann.publish' | 'ann.delete' | 'doc.version' | ...
  subject TEXT NOT NULL,
  category TEXT NOT NULL,
  target_type TEXT,
  target_id BIGINT,
  requested_by TEXT NOT NULL REFERENCES users(username),
  approver TEXT NOT NULL REFERENCES users(username),
  status TEXT NOT NULL DEFAULT 'bekliyor' CHECK (status IN ('bekliyor','onaylandi','reddedildi','geri_cekildi')),
  reason TEXT,
  decision_reason TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approval_requests_approver_idx ON approval_requests(approver, status);

CREATE TABLE IF NOT EXISTS policy_documents (
  id BIGSERIAL PRIMARY KEY,
  doc_no TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'teftis_onayinda' CHECK (status IN ('teftis_onayinda','yayinda','taslaga_dondu')),
  created_by TEXT NOT NULL REFERENCES users(username),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT,
  page_count INTEGER NOT NULL DEFAULT 1,
  effective_date DATE,
  reject_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_no, version)
);

CREATE TABLE IF NOT EXISTS training_assignments (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users(username),
  policy_document_id BIGINT NOT NULL REFERENCES policy_documents(id),
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  quiz_score INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (username, policy_document_id)
);
