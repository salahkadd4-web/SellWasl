-- Curseur de synchronisation fiable (phase 23, spec §3.1) : chaque écriture d'une ligne
-- synchronisée enregistre aussi sa transaction (identifiant sur 64 bits, sans bouclage).
-- Le téléphone reçoit comme curseur la plus ancienne transaction encore en cours : une ligne
-- validée après une lecture ne peut pas être manquée.
CREATE OR REPLACE FUNCTION sync_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.change_seq := nextval('sync_change_seq');
  NEW.change_xid := pg_current_xact_id()::text::bigint;
  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = current_schema() AND column_name = 'change_seq'
           ORDER BY table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN change_xid BIGINT NOT NULL DEFAULT 0', t);
    EXECUTE format('CREATE INDEX %I ON %I (company_id, change_xid)', t || '_company_id_change_xid_idx', t);
  END LOOP;
END $$;
