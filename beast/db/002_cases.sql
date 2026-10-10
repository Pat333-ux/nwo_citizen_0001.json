CREATE TABLE IF NOT EXISTS identities (
  id                 UUID PRIMARY KEY,
  did                TEXT NOT NULL UNIQUE,
  type               TEXT NOT NULL,
  jurisdiction       TEXT NOT NULL,
  verification_level INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL,
  reputation         INTEGER NOT NULL DEFAULT 0,
  wallet             TEXT,
  hash               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL,
  updated_at         TIMESTAMPTZ NOT NULL
);

-- PII lives in its own table (values are AES-256-GCM ciphertext); never joined into ledger data.
CREATE TABLE IF NOT EXISTS identity_pii (
  identity_id       UUID PRIMARY KEY REFERENCES identities(id),
  encrypted_name    TEXT NOT NULL,
  encrypted_address TEXT NOT NULL,
  encrypted_email   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  family_id         UUID PRIMARY KEY,
  identity_id       UUID NOT NULL REFERENCES identities(id),
  adults            INTEGER NOT NULL,
  children          INTEGER NOT NULL,
  monthly_income    NUMERIC NOT NULL,
  veteran_status    BOOLEAN NOT NULL,
  disability_status BOOLEAN NOT NULL,
  housing_status    TEXT NOT NULL,
  status            TEXT NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beast_ledger_app') THEN
    CREATE ROLE beast_ledger_app NOLOGIN;
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON identities, identity_pii, applications TO beast_ledger_app;
