#!/usr/bin/env bash
# Backup/restore validation. Dumps SOURCE_URL, restores into a scratch database on the same
# server, and proves the restored copy is identical: row counts, ledger chain valid, Merkle root equal.
# SOURCE_URL must not contain a query string (e.g. ?sslmode=...); set PGSSLMODE in the environment instead.
# Usage: SOURCE_URL=******host:5432/beast scripts/restore-check.sh
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL}"
case "$SOURCE_URL" in *\?*) echo "SOURCE_URL must not contain a query string" >&2; exit 2;; esac
SCRATCH="beast_restore_check_$(date +%s)"
ADMIN_URL="${ADMIN_URL:-${SOURCE_URL%/*}/postgres}"
DUMP="$(mktemp)"
RESTORE_URL="${SOURCE_URL%/*}/$SCRATCH"
cleanup() { rm -f "$DUMP"; psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS $SCRATCH" >/dev/null 2>&1 || true; }
trap cleanup EXIT
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "1/4 backup"
pg_dump -Fc --no-owner --no-privileges "$SOURCE_URL" -f "$DUMP"
echo "2/4 restore into $SCRATCH"
psql "$ADMIN_URL" -qc "CREATE DATABASE $SCRATCH" >/dev/null
pg_restore --no-owner --no-privileges -d "$RESTORE_URL" "$DUMP"
echo "3/4 fingerprint both"
BEFORE="$(node "$HERE/fingerprint.ts" "$SOURCE_URL")"
AFTER="$(node "$HERE/fingerprint.ts" "$RESTORE_URL")"
echo "source:   $BEFORE"
echo "restored: $AFTER"
echo "4/4 compare"
if [ "$BEFORE" = "$AFTER" ] && echo "$AFTER" | grep -q '"ledgerValid":true'; then
  echo "RESTORE VALIDATED"
else
  echo "RESTORE FAILED: restored data differs or ledger invalid" >&2
  exit 1
fi
