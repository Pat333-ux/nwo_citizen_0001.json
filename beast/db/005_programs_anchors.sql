CREATE TABLE IF NOT EXISTS programs (
  id          TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,64}$'),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  rule_set    TEXT, -- key of a rule set shipped with the code; NULL means no automated recommendations
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO programs (id, name, description, rule_set) VALUES
  ('family-first',    'Family First',    'Family support program', 'family-first'),
  ('housing',         'Housing',         'Housing assistance', NULL),
  ('employment',      'Employment',      'Employment services', NULL),
  ('veteran-support', 'Veteran Support', 'Veteran support services', NULL),
  ('food-security',   'Food Security',   'Food assistance', NULL),
  ('education',       'Education',       'Education support', NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE applications ADD COLUMN IF NOT EXISTS program_id TEXT NOT NULL DEFAULT 'family-first' REFERENCES programs(id);

-- Merkle roots of the ledger published to an external network. Contains no PII.
CREATE TABLE IF NOT EXISTS ledger_anchors (
  id          UUID PRIMARY KEY,
  root        TEXT NOT NULL,
  records     INTEGER NOT NULL,
  network     TEXT NOT NULL,
  tx_ref      TEXT NOT NULL,
  anchored_at TIMESTAMPTZ NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beast_ledger_app') THEN
    CREATE ROLE beast_ledger_app NOLOGIN;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON programs TO beast_ledger_app;
GRANT SELECT, INSERT ON ledger_anchors TO beast_ledger_app;
