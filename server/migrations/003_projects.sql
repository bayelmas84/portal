-- 003_projects.sql

CREATE TABLE IF NOT EXISTS projects (
  k TEXT PRIMARY KEY,                 -- proje kodu, örn. TRADE
  name TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'Scrum' CHECK (method IN ('Scrum','Kanban','Waterfall')),
  lead_username TEXT REFERENCES users(username),
  health TEXT NOT NULL DEFAULT 'İzleniyor',
  unit_name TEXT,
  start_date DATE,
  target_date DATE,
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Teftiş ve Kurumsal Risk her projede zorunlu üyedir; uygulama katmanı
-- (server/src/lib/projectTeam.js) bu iki üyeliği hiçbir zaman silinmeyecek
-- şekilde garanti eder.
CREATE TABLE IF NOT EXISTS project_team (
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  username TEXT NOT NULL REFERENCES users(username),
  project_role TEXT NOT NULL,          -- 'Product Owner','Business Owner','Developer','QA','Vendor','Analyst','Internal Audit','Risk',...
  mandatory BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (project_k, username)
);

-- Sabit tip sırası: bir tip bir öncekinin tam onayı olmadan yüklenemez
-- (PK -> BRD -> FRD -> UAT -> Go Live -> Risk ve Uyumluluk -> Kapanış).
CREATE TABLE IF NOT EXISTS project_documents (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('Proje Kartı','BRD','FRD','UAT','Go Live','Risk ve Uyumluluk','Kapanış')),
  title TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0',
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_sha256 TEXT,
  page_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'onay_akisinda' CHECK (status IN ('onay_akisinda','onaylandi','reddedildi')),
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 6),
  reject_reason TEXT,
  uploaded_by TEXT NOT NULL REFERENCES users(username),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_date TIMESTAMPTZ,
  UNIQUE (project_k, doc_type)
);

-- Altı adımlı onay zinciri: Ürün Sahibi -> İş Birimi Sahibi -> PO yöneticisi
-- -> BO yöneticisi -> Teftiş -> Kurumsal Risk Grup Direktörü.
CREATE TABLE IF NOT EXISTS project_document_approvals (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  step_no INTEGER NOT NULL CHECK (step_no BETWEEN 1 AND 6),
  step_name TEXT NOT NULL,
  approver_username TEXT NOT NULL REFERENCES users(username),
  is_proxy BOOLEAN NOT NULL DEFAULT false,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, step_no)
);

CREATE TABLE IF NOT EXISTS change_requests (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  no TEXT NOT NULL,
  title TEXT NOT NULL,
  reason TEXT NOT NULL,
  impact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'onayda' CHECK (status IN ('taslak','onayda','onaylandi','reddedildi')),
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_k, no)
);

CREATE TABLE IF NOT EXISTS change_request_approvals (
  id BIGSERIAL PRIMARY KEY,
  change_request_id BIGINT NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  username TEXT NOT NULL REFERENCES users(username),
  capacity TEXT NOT NULL CHECK (capacity IN ('manager','team')),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS gantt_tasks (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
