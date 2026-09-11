-- Proje dokümanları (d.docs, d.docview) — genel Doküman Yönetimi'nden (documents/k.docs)
-- tamamen ayrı, projeye bağlı bir modül. HAZIRLIK-DURUMU.md bölüm 5.
--
-- Sabit tip listesi ve sıra kuralı: bir projede DOC_TYPE_ORDER sırasındaki bir tip
-- yüklenmeden bir sonraki tip yüklenemez (uygulama tarafında lib/projectDocs.js
-- kontrol eder; burada yalnızca CHECK ile geçerli tipler sınırlanır).
--
-- project_id + doc_type tekildir: bir projede her tipten tek "aktif" doküman olur.
-- Reddedilen doküman yeniden yüklenebilir (aynı satır güncellenir, current_step 1'e döner).

CREATE TABLE IF NOT EXISTS project_documents (
  id             BIGSERIAL PRIMARY KEY,
  project_id     BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_type       TEXT NOT NULL CHECK (doc_type IN (
                   'Proje Kartı','BRD','FRD','UAT','Go Live','Risk ve Uyumluluk','Kapanış'
                 )),
  title          TEXT NOT NULL,
  version        TEXT NOT NULL DEFAULT '1.0',
  file_name      TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  file_sha256    TEXT NOT NULL,
  page_count     INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL CHECK (status IN ('onay_akisinda','onaylandi','reddedildi')) DEFAULT 'onay_akisinda',
  current_step   INTEGER NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 6),
  reject_reason  TEXT,
  uploaded_by    TEXT NOT NULL REFERENCES users(username),
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_date TIMESTAMPTZ,
  UNIQUE (project_id, doc_type)
);
CREATE INDEX IF NOT EXISTS project_documents_project_idx ON project_documents(project_id);

-- Altı adımlı onay zincirinin geçmişi (onaycılar günlüğünün temeli — d.appr ileride
-- büyük olasılıkla doğrudan bu tablodan okuyacak, ayrı bir depoya gerek kalmayabilir).
CREATE TABLE IF NOT EXISTS project_document_approvals (
  id                 BIGSERIAL PRIMARY KEY,
  document_id        BIGINT NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  step_no            INTEGER NOT NULL CHECK (step_no BETWEEN 1 AND 6),
  step_name          TEXT NOT NULL,
  approver_username  TEXT NOT NULL REFERENCES users(username),
  is_proxy           BOOLEAN NOT NULL DEFAULT FALSE,
  approved_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, step_no)
);
