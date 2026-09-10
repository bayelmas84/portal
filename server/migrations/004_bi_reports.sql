-- BI rapor kataloğu. Raporun kendisi ayrı BI servisinde (PRISMA) çalışır;
-- portal kimlik, yetki, yaşam döngüsü ve denetim izini tutar.
CREATE TABLE IF NOT EXISTS bi_reports (
  id            BIGSERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  area          TEXT NOT NULL,
  frequency     TEXT NOT NULL DEFAULT 'günlük',
  description   TEXT,
  bi_path       TEXT NOT NULL,          -- BI servisindeki rapor yolu; tam URL sunucuda kurulur
  status        TEXT NOT NULL CHECK (status IN ('gelistirme','onayda','yayinda','emekli')) DEFAULT 'gelistirme',
  version       INTEGER NOT NULL DEFAULT 1,
  owner         TEXT NOT NULL,          -- raporu geliştiren/sahibi
  allowed_roles JSONB NOT NULL DEFAULT '[]'::jsonb,   -- boş dizi: yetkili tüm roller
  reject_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,
  retired_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS bi_status_idx ON bi_reports(status);

-- Rapor açılışları denetim kaydına da yazılır; bu tablo kullanım raporu içindir.
CREATE TABLE IF NOT EXISTS bi_report_opens (
  id         BIGSERIAL PRIMARY KEY,
  report_id  BIGINT NOT NULL REFERENCES bi_reports(id) ON DELETE CASCADE,
  username   TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS bi_opens_idx ON bi_report_opens(report_id, at);
