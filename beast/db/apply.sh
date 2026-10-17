#!/usr/bin/env bash
# Applies all migrations in order. Idempotent. Usage: DATABASE_URL=postgres://... ./db/apply.sh
# For Cloud SQL, run it through the Cloud SQL Auth Proxy.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
cd "$(dirname "$0")"
for f in 00*.sql; do
  echo "applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
