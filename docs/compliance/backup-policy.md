# Backup Policy

- PostgreSQL: daily full backups plus continuous WAL archiving.
- Ledger and PII stores are backed up separately; PII backups are encrypted with separate keys.
- Backups are stored off-site, access-controlled, and tested by restoration at least quarterly.
- After any restore, the ledger hash chain is re-verified from genesis (`BEAST_GENESIS_2026`).
- Backup retention follows the Data Retention Policy.
