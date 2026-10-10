# Backup, Restore, Crash Recovery and Incident Drill

## Backup and restore: automated check (done)
`beast/scripts/restore-check.sh` runs `pg_dump`, restores into a scratch database, and compares row counts, ledger validity and Merkle root between source and restore via `beast/scripts/fingerprint.ts`. It passed locally on PostgreSQL 16 (53 ledger records identical, root equal) and runs in CI against the test database.

Still required before go-live (operators): run it against the real pilot database with real storage, record the time taken (RTO) and backup age (RPO) against `docs/compliance/disaster-recovery-plan.md`, store dumps encrypted, and keep `PII_KEY_HEX` and `MFA_KEY_HEX` backed up separately: without them restored PII and MFA secrets are unreadable. Repeat monthly.

## Crash recovery (operators to run)
1. Under case-write load `kill -9` the API, then the Postgres container separately.
2. Restart; run `fingerprint.ts`: ledger valid, no duplicate sequences, no case without its ledger record.

## Incident drill
See [incident-drill-compromised-admin.md](incident-drill-compromised-admin.md). Not yet performed; record date, participants, timings and gaps there.
