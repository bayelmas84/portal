-- 006_training_quiz.sql
-- Kavrama sınavı sorularını ve doğru cevaplarını SUNUCU tarafında saklar.
-- Bu tablo istemciye asla doğrudan gönderilmez; yalnızca soru metni ve
-- şıklar (doğru cevap OLMADAN) gönderilir, puanlama sunucuda yapılır.

CREATE TABLE IF NOT EXISTS policy_document_questions (
  id BIGSERIAL PRIMARY KEY,
  policy_document_id BIGINT NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,              -- ["Şık A","Şık B","Şık C","Şık D"]
  correct_index INTEGER NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS pdq_doc_idx ON policy_document_questions(policy_document_id, position);
