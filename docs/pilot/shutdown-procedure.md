# Shutdown Procedure (draft)

1. Pilot lead declares shutdown; record the reason and time.
2. Stop new intake: deactivate caseworker accounts (admin).
3. Run `/v1/ledger/verify`; record the Merkle root.
4. Take a final database backup; verify it restores.
5. Notify participants per [privacy-notice.md](privacy-notice.md) and the appeal process.
6. Retain or delete data per `docs/compliance/data-retention-policy.md` and `data-deletion-policy.md`; note that ledger entries are append-only, so keep PII out of them.
7. Revoke secrets (`JWT_SECRET`, DB credentials), tear down infrastructure, retain the backup under the retention policy.
8. Write a closing report.
