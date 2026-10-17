#!/usr/bin/env bash
# Applies migrations in order and records them in schema_migrations, so it is safe to re-run.
# Usage: DATABASE_URL=postgres://... ./db/apply.sh   (for Cloud SQL, use the Cloud SQL Auth Proxy)
# Databases created before this script existed: mark migrations already applied, e.g.
#   psql "$DATABASE_URL" -c "CREATE TABLE IF NOT EXISTS schema_migrations(name text primary key); INSERT INTO schema_migrations VALUES ('001_ledger.sql'),('002_cases.sql'),('003_users.sql') ON CONFLICT DO NOTHING"
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
cd "$(dirname "$0")"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
for f in 00*.sql; do
  done_already=$(psql "$DATABASE_URL" -At -c "SELECT 1 FROM schema_migrations WHERE name = '$f'")
  if [ -n "$done_already" ]; then echo "skip $f"; continue; fi
  echo "applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "INSERT INTO schema_migrations (name) VALUES ('$f')"
done
