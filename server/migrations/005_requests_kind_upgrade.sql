-- Yalnızca 1.2 öncesi kurulumlar için: requests.kind kısıtına rapor türlerini ekler.
-- Yeni kurulumlarda 001_init.sql bu türleri zaten içerir ve bu dosya bir şey değiştirmez.
-- Onay akışına rapor türleri eklenir.
-- Yeni kurulumlarda 001_init.sql zaten bu türleri içerir; bu adım eski kurulumlar içindir.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'requests'::regclass
       AND pg_get_constraintdef(c.oid) LIKE '%kind%'
       AND pg_get_constraintdef(c.oid) NOT LIKE '%report.publish%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE requests DROP CONSTRAINT ' || quote_ident(c.conname)
        FROM pg_constraint c
       WHERE c.conrelid = 'requests'::regclass
         AND pg_get_constraintdef(c.oid) LIKE '%kind%'
       LIMIT 1);
    ALTER TABLE requests ADD CONSTRAINT requests_kind_check
      CHECK (kind IN ('ann.publish','ann.delete','doc.publish','doc.delete','report.publish','report.retire'));
  END IF;
END $$;
