-- 015_approval_rules.sql
-- Onay kuralı matrisi: duyuru kategorisine göre kimin onaylayacağı artık
-- admin panelinden yönetilebilir. approver_role: 'manager' (talebi açanın
-- yöneticisi) ya da bir rol adı (örn. 'inspection') olabilir.
CREATE TABLE IF NOT EXISTS approval_rules (
  category TEXT PRIMARY KEY,
  approver_role TEXT NOT NULL,
  updated_by TEXT REFERENCES users(username),
  updated_at TIMESTAMPTZ
);

INSERT INTO approval_rules (category, approver_role) VALUES
  ('Genel', 'manager'),
  ('Yasal', 'inspection')
ON CONFLICT (category) DO NOTHING;
