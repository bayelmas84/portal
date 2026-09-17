-- 046_todo_items.sql
-- Kişisel to-do listesi: her kullanıcı yalnızca kendi kalemlerini görür/
-- yönetir. Herhangi bir proje/issue ile ilişkilendirilmez, tamamen özel.
-- status: 'open' | 'waiting' | 'prog' | 'done' | 'cancel'
-- completion_date doldurulunca (yalnızca status='done' iken anlamlı)
-- archived=true olur ve normal listeden düşer.
CREATE TABLE IF NOT EXISTS todo_items (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users(username),
  category TEXT NOT NULL DEFAULT 'Genel',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','waiting','prog','done','cancel')),
  create_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  completion_date DATE,
  archived BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_todo_items_username ON todo_items(username, archived, status);
