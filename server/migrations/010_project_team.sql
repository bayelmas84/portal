-- Proje ekibi: her projenin dokuz olası rolden oluşan üyeleri.
-- Bu tablo, üretimde henüz olmayan "Proje ekibi (d.team)" bölümünü temellendirir;
-- ileride doküman onay zinciri ve ekip-bazlı salt okunur erişim de buradan okuyacaktır
-- (docs/HAZIRLIK-DURUMU.md bölüm 5).
--
-- project_role: kullanıcının bu projedeki rolü. Kullanıcının genel role_key'inden
-- (users.role_key, modül yetkilerini belirler) bağımsızdır — bir Geliştirici bir
-- projede Business Owner olarak da atanabilir; bu yalnızca proje ekibi bilgisidir.
--
-- is_mandatory: Internal Audit (Teftiş) ve Risk üyeliği. CHANGELOG 1.13.1'e göre bu
-- ikisi her projede zorunludur, ekipten çıkarılamaz. Uygulama tarafı bunu ensureMandatoryMembers()
-- ile hem yeni proje oluşturulduğunda hem de mevcut projelerde (lazy backfill) sağlar.

CREATE TABLE IF NOT EXISTS project_members (
  project_id   BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  username     TEXT NOT NULL REFERENCES users(username),
  project_role TEXT NOT NULL CHECK (project_role IN (
                 'Project Manager','Developer','QA','Business Owner','Product Owner',
                 'Internal Audit','Risk','Vendor','Analyst'
               )),
  is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
  added_by     TEXT REFERENCES users(username),
  added_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, username)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members(username);

-- Zorunlu üye yalnızca "Internal Audit" veya "Risk" rolündeyse zorunlu sayılır;
-- aynı kişi ikisini birden taşıyamaz (tek satır, PRIMARY KEY project_id+username).
