-- TOTP multi-factor authentication for staff accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step BIGINT NOT NULL DEFAULT 0;
