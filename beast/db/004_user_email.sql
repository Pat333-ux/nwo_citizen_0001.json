-- Optional verified Google account email, linked to an existing user by an admin.
-- Google sign-in never creates accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
