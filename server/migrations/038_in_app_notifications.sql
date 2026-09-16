-- 038_in_app_notifications.sql

-- Konu (issue) etkinlikleri için uygulama içi bildirim kutusu: yorum,
-- @mention, atama. Duyuru/onay/eğitim bildirimleri zaten kendi tablolarından
-- (announcement_reads, approval_requests, training_assignments) türetiliyor;
-- bu üçünde "okundu" bilgisini tutacak doğal bir yer olmadığı için ayrı,
-- kalıcı bir tablo kullanılır.
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_username TEXT NOT NULL REFERENCES users(username),
  kind TEXT NOT NULL CHECK (kind IN ('comment','mention','assignment')),
  project_k TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  title TEXT NOT NULL,
  actor_username TEXT NOT NULL REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS in_app_notifications_recipient_idx
  ON in_app_notifications(recipient_username, read_at, created_at DESC);
