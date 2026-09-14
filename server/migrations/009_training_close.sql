-- 009_training_close.sql

-- Tamamlanmış (en az bir kullanıcı tarafından okunmuş/sınavı geçilmiş) bir zorunlu
-- okuma dokümanı asla düzenlenemez veya silinemez. Emekliye ayırmanın (retiring)
-- TEK yolu: dokümanı yükleyen kişi bir "kapatma talebi" açar; bu talep hem yükleyenin
-- yöneticisi HEM DE Teftiş tarafından onaylanmadan hiçbir etkisi olmaz. Yeni bir
-- ihtiyaç varsa yeni bir doküman/sürüm yayınlanır (mevcut POST /documents ile).
ALTER TABLE policy_documents DROP CONSTRAINT IF EXISTS policy_documents_status_check;
ALTER TABLE policy_documents ADD CONSTRAINT policy_documents_status_check
  CHECK (status IN ('teftis_onayinda','yayinda','taslaga_dondu','kapali'));

ALTER TABLE policy_documents ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE policy_documents ADD COLUMN IF NOT EXISTS closed_reason TEXT;
