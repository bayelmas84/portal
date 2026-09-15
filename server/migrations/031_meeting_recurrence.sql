-- 031_meeting_recurrence.sql

-- Toplantılara periyodiklik (recurrence) eklenir: weekly | monthly | quarterly
-- ya da NULL (tek seferlik). Yalnızca periyodik toplantılarda madde taşıma
-- (carry-over) yapılabilir; tek seferlik toplantılarda bu özellik kapalıdır.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS recurrence TEXT
  CHECK (recurrence IN ('weekly','monthly','quarterly'));
