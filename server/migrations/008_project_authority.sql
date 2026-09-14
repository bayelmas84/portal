-- Proje Yönetim Direktörü ünvanı ve rolü.
-- Proje Yönetimi modülünün tamamında tam yetkilidir (okuma, ekleme, değiştirme, silme).
-- Faz kapısında tek imzayla ilerletme yetkisi vardır; bu bir override'dır, gerekçe
-- zorunludur ve ayrı bir denetim olayı olarak kayda geçer.

INSERT INTO titles (code, name, seniority) VALUES ('PYD', 'Proje Yönetim Direktörü', 'director')
  ON CONFLICT (code) DO NOTHING;

INSERT INTO roles (key, label) VALUES ('pmd', 'Proje Yönetim Direktörü')
  ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;

-- Tek imzayla geçişin kaydı
ALTER TABLE stage_gates ADD COLUMN IF NOT EXISTS override_by TEXT;
ALTER TABLE stage_gates ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE stage_gates ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ;
