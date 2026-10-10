-- Append-only ledger. Run as a migration owner; the application role gets INSERT and SELECT only.
CREATE TABLE IF NOT EXISTS ledger_records (
  id            UUID PRIMARY KEY,
  sequence      BIGINT NOT NULL UNIQUE,
  previous_hash TEXT NOT NULL,
  payload_hash  TEXT NOT NULL,
  current_hash  TEXT NOT NULL UNIQUE,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  timestamp_ms  BIGINT NOT NULL
);

CREATE OR REPLACE FUNCTION ledger_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_records is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update_delete
  BEFORE UPDATE OR DELETE ON ledger_records
  FOR EACH ROW EXECUTE FUNCTION ledger_block_mutation();

CREATE TRIGGER ledger_no_truncate
  BEFORE TRUNCATE ON ledger_records
  FOR EACH STATEMENT EXECUTE FUNCTION ledger_block_mutation();

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beast_ledger_app') THEN
    CREATE ROLE beast_ledger_app NOLOGIN;
  END IF;
END $$;
REVOKE ALL ON ledger_records FROM PUBLIC;
GRANT INSERT, SELECT ON ledger_records TO beast_ledger_app;
