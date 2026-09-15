-- 030_meeting_carry_linked_issue.sql

-- "Sonraki toplantıya aktar" ile taşınan bir madde, önceki toplantıda zaten
-- bir Task olarak açılmıştı. Bu Task'ın anahtarı burada saklanır ki yeni
-- toplantıya eklendiğinde AYNI Task yeniden kullanılsın — mükerrer bir
-- Task açılmasın.
ALTER TABLE meeting_carry_queue ADD COLUMN IF NOT EXISTS linked_issue_key TEXT;
