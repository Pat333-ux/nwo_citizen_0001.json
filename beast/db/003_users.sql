CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, -- Argon2id
  role          TEXT NOT NULL CHECK (role IN ('caseworker', 'admin', 'auditor')),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'beast_ledger_app') THEN
    CREATE ROLE beast_ledger_app NOLOGIN;
  END IF;
END $$;
-- Accounts are disabled, never deleted.
GRANT SELECT, INSERT, UPDATE ON users TO beast_ledger_app;
