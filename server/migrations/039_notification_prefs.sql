-- 039_notification_prefs.sql

-- Kullanıcı bazlı MAIL bildirim tercihleri. Uygulama içi (zil) bildirimler
-- bu tercihlerden etkilenmez — her zaman oluşturulur; yalnızca dışarı giden
-- e-posta gönderimi burada kapatılabilir. Kayıt yoksa varsayılan: hepsi açık.
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  username TEXT PRIMARY KEY REFERENCES users(username),
  email_on_comment BOOLEAN NOT NULL DEFAULT true,
  email_on_mention BOOLEAN NOT NULL DEFAULT true,
  email_on_assignment BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
