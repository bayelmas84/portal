-- Örnek kavrama sınavı soruları. Kurum kendi sorularını Admin Panel yerine
-- veritabanına bu biçimde ekler (soru bankası yönetimi 1.1 sürümünde arayüze taşınacaktır).
INSERT INTO quiz_questions (doc_no, weight_band, question, options, answer_index)
SELECT * FROM (VALUES
 ('PL-ETIK-002','critical','Kamuya açıklanmamış bilgiye dayanarak sermaye piyasası işlemi yapmak nedir?',
  '["Yasaktır ve disiplin sürecine tabidir","Yöneticinin onayıyla yapılabilir","Küçük tutarlarda serbesttir"]'::jsonb,0),
 ('PL-ETIK-002','critical','Çıkar çatışması doğuran bir durumu öğrendiğinizde ne yapılır?',
  '["Öğrenildiği anda Uyum Birimine yazılı bildirilir","Yıl sonu beyanında belirtilir","Önemsizse bildirilmez"]'::jsonb,0),
 ('PL-ETIK-002','high','Sembolik değeri aşan hediye teklif edildiğinde doğru davranış nedir?',
  '["Kabul edilemez","Kabul edilir, kayda gerek yoktur","Ekip adına kabul edilir"]'::jsonb,0),
 ('PL-ETIK-002','medium','Kabul edilen hediye için kayda hangi bilgiler işlenir?',
  '["Değeri, tarihi ve verenin kimliği","Yalnızca değeri","Kayıt gerekmez"]'::jsonb,0),
 ('PL-ETIK-002','low','Müşteri çıkarı ile çalışanın kişisel çıkarı çatıştığında hangisi önde gelir?',
  '["Müşteri çıkarı","Çalışanın çıkarı","Duruma göre değişir"]'::jsonb,0)
) AS v(doc_no, weight_band, question, options, answer_index)
WHERE NOT EXISTS (SELECT 1 FROM quiz_questions WHERE doc_no = 'PL-ETIK-002');
