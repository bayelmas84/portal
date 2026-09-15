-- 024_inspection_control_broad_read.sql
-- Kullanıcı kararı: Teftiş (inspection), İç Kontrol (control) ve IT İç Kontrol
-- (infosec) rolleri, kendi görev alanlarının (write yetkili oldukları ekranlar)
-- DIŞINDA kalan HER ekranı da görebilmelidir (read) — örn. Proje Yönetimi'ndeki
-- tüm menüler bu roller için açık olacak, yalnızca değişiklik yapamayacaklar.
-- ON CONFLICT DO NOTHING: bu üç rol için zaten VAR OLAN bir kayıt (örn. write
-- yetkisi) varsa asla EZİLMEZ, yalnızca hiç kaydı olmayan ekranlara "read"
-- eklenir.
INSERT INTO role_access (role, screen_key, level)
SELECT r.role, s.screen_key, 'read'
FROM (VALUES ('inspection'), ('control'), ('infosec')) AS r(role)
CROSS JOIN (VALUES
  ('d.team'), ('d.cr'), ('d.gantt'), ('d.board'), ('d.gate'),
  ('d.appr'), ('d.docs'), ('d.docview'), ('d.meeting'), ('d.meetingview'),
  ('c.audit'), ('announcements'), ('training'),
  ('m.users'), ('m.units'), ('m.dir'), ('m.smtp'), ('m.brand'),
  ('m.mailtpl'), ('m.settings'), ('m.approvalrules'), ('m.avail'), ('m.access')
) AS s(screen_key)
ON CONFLICT (role, screen_key) DO NOTHING;
