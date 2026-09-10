-- Ekranlarda görünen marka ve metinler. Tek satırlık tablodur (id = 1).
-- Portal başka bir kurum veya ürün adıyla kullanılacaksa yalnızca bu kayıt doldurulur.
CREATE TABLE IF NOT EXISTS brand_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company        TEXT,
  company_short  TEXT,
  product        TEXT,
  product_mark   TEXT,
  slogan         TEXT,
  login_title    TEXT,
  login_hint     TEXT,
  footer         TEXT,
  signature      TEXT,
  accent         TEXT,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO brand_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
