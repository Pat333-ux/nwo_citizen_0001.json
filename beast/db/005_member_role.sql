-- Member role: public users who sign in with Google only, linked to exactly one identity.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('caseworker', 'admin', 'auditor', 'member'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_id UUID UNIQUE REFERENCES identities(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
-- Members must be linked to an identity; staff must not be.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_member_identity_check;
ALTER TABLE users ADD CONSTRAINT users_member_identity_check CHECK ((role = 'member') = (identity_id IS NOT NULL));
