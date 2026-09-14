-- 010_audit_and_soft_delete.sql

-- Denetim kaydı: işlem tipi ve onay zincirindeki kişiler (varsa) ayrı kolonlarda.
-- "Birimi" saklanmaz; sorgu anında users.unit ile JOIN edilerek okunur (kullanıcının
-- o anki birimini değil, olay anındaki en güncel bilgisini basitçe göstermek için
-- yeterlidir; geçmişe dönük birim değişiklikleri bu prototipte izlenmez).
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT 'diger';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS approver1 TEXT REFERENCES users(username);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS approver2 TEXT REFERENCES users(username);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS approver3 TEXT REFERENCES users(username);

-- İki adımlı (sıralı) onay zincirleri için: 1 = ilk onaycı (yönetici), 2 = ikinci/son
-- onaycı (Teftiş). Rol bazlı tahmin yerine (yöneticinin kendisi de Teftiş'ten olabilir)
-- açıkça hangi adımda olunduğunu tutar.
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS step INTEGER NOT NULL DEFAULT 1;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS total_steps INTEGER NOT NULL DEFAULT 1;

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_status_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_status_check
  CHECK (status IN ('onayda','yayinda','geri_cekildi','silindi'));

-- Eğitim ataması iptali de aynı kuralla: DELETE değil, cancelled_at ile işaretlenir
-- ve atama listelerinde gösterilmez; tamamlanmış kayıtlara asla dokunulmaz zaten.
ALTER TABLE training_assignments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
