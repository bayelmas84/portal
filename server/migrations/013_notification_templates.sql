-- 013_notification_templates.sql

-- Mail şablonları: her bildirim türü (doküman ataması, eğitim ataması, onay
-- akışı bildirimleri vb.) için ayrı bir tanım. Girişi/değişikliği/silmesi HER
-- ZAMAN iki adımlı onaydan (önce yönetici, sonra Teftiş) geçer — tıpkı duyuru
-- silme ve eğitim kapatma gibi. Bu yüzden gerçek içerik SADECE onay tamamlanınca
-- yazılır; decide ucu (announcements.js) bu tabloyu da yönetir.
CREATE TABLE IF NOT EXISTS notification_templates (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,      -- örn. 'training.assigned', 'approval.pending'
  name TEXT NOT NULL,                  -- yönetici panelinde görünen ad
  subject TEXT NOT NULL,               -- {ad_soyad}, {baslik}, {son_tarih} gibi yer tutucular içerebilir
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','kapali')),
  created_by TEXT REFERENCES users(username),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT REFERENCES users(username),
  updated_at TIMESTAMPTZ
);

-- Gönderen adresi ve görünen ad: portal@terayatirim.com / "Tera Portal".
-- (Bu kutuya gerçek erişim/yetki ayrıca kurumsal süreçle talep edilecek;
-- burada yalnızca varsayılan değer olarak ayarlanıyor.)
ALTER TABLE smtp_settings ADD COLUMN IF NOT EXISTS from_name TEXT NOT NULL DEFAULT 'Tera Portal';
UPDATE smtp_settings SET from_addr = 'portal@terayatirim.com', from_name = 'Tera Portal'
  WHERE id = 1 AND (from_addr IS NULL OR from_addr = '');
