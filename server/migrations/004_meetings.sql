-- 004_meetings.sql

CREATE TABLE IF NOT EXISTS meetings (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT REFERENCES projects(k) ON DELETE CASCADE,   -- NULL ise "Diğer"
  project_other_subject TEXT,          -- yalnızca project_k NULL iken kullanılır
  title TEXT NOT NULL,
  meeting_date DATE NOT NULL,
  meeting_time TEXT,
  notes TEXT,
  created_by TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (project_k IS NOT NULL OR project_other_subject IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  username TEXT NOT NULL REFERENCES users(username),
  PRIMARY KEY (meeting_id, username)
);

CREATE TABLE IF NOT EXISTS meeting_items (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled','carried')),
  carried_from_meeting_id BIGINT REFERENCES meetings(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- "Sonraki toplantıya aktar" ile kapatılan madde, aynı proje için yeni bir
-- toplantı notu açılana kadar burada bekler; yeni not oluşturulunca otomatik
-- olarak gündeme (meeting_items, carried_from_meeting_id dolu) eklenir ve
-- buradan silinir.
CREATE TABLE IF NOT EXISTS meeting_carry_queue (
  id BIGSERIAL PRIMARY KEY,
  project_k TEXT NOT NULL REFERENCES projects(k) ON DELETE CASCADE,
  text TEXT NOT NULL,
  from_meeting_id BIGINT NOT NULL REFERENCES meetings(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
