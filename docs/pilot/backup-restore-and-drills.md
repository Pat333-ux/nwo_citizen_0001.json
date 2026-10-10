# Backup, Restore, Crash Recovery and Incident Drill (test plans)

Mark each with date, tester, result and evidence. Open until run.

## Backup and restore
1. `pg_dump -Fc` the database to encrypted storage.
2. Restore into a clean Postgres; apply no extra migrations.
3. Start the API on the restored DB; `/v1/ledger/verify` must pass and the Merkle root must equal the pre-backup root.
4. Record RPO/RTO achieved vs `docs/compliance/disaster-recovery-plan.md`.

## Crash recovery
1. Under load of case writes, `kill -9` the API, then separately the Postgres container.
2. Restart. Verify no partial case/ledger pairs (atomicity), ledger verify passes, and no duplicate sequence numbers.

## Incident response drill
Tabletop: suspected credential theft by a caseworker. Walk through `docs/compliance/incident-response-plan.md`: detect, contain (deactivate user, rotate JWT secret), audit via ledger, notify per breach plan, write lessons learned. Record gaps as issues.
