-- 014_app_settings.sql
-- Genel parametrik ayarlar: eğitim/doküman kuralları, sprint varsayılanları vb.
-- key-value (brand_settings ile aynı desen). Admin onayına (admin.action) tabidir.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(username),
  updated_at TIMESTAMPTZ
);

INSERT INTO app_settings (key, value) VALUES
  ('reading_seconds_per_page', '30'),
  ('quiz_pass_score', '70'),
  ('training_default_due_days', '14'),
  ('sprint_default_days', '14'),
  ('story_point_scale', '1,2,3,5,8,13,21')
ON CONFLICT (key) DO NOTHING;
