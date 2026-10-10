# BEAST 3.0 Pilot Gate

Drafts for a small supervised Family First pilot. Not legal advice; every document needs owner review and sign-off. Prototype: not authorized or certified for federal or state use.

## Gate status

Code items below are verified against `beast/` as of this document; everything else is open until evidence is attached.

### Security
- [x] Ledger atomicity
- [x] User atomicity
- [x] Ledger lockdown. The former `POST /v1/ledger/events` route was removed; the ledger is read-only over HTTP and written only inside services. Tested in `beast/test/server.test.ts`. Deployment must still restrict network access to Postgres and use the `beast_ledger_app` grants.
- [x] MFA for all staff roles. TOTP (RFC 6238) in `beast/src/auth/totp.ts`; the server sets `requireMfa: true`, so unenrolled accounts can only reach `/v1/auth/mfa/*`. Tested in `beast/test/mfa.test.ts`. Admins reset MFA with `POST /v1/users/{id}/mfa/reset`.
- [ ] Threat-model review: see [threat-model.md](threat-model.md)
- [ ] Audit verification: see [auditor-guide.md](auditor-guide.md)

### Database
- [x] PostgreSQL validation (all DB tests pass on PostgreSQL 16 with migrations 001-004; CI job `test` runs them)
- [x] Concurrent-write testing (`beast/test/postgres.test.ts`: 25 parallel appends, unique sequences, valid chain)
- [ ] Crash-recovery testing: see [backup-restore-and-drills.md](backup-restore-and-drills.md)
- [ ] Required CI enforcement (GitHub branch protection: require `BEAST CI / test` and `docker`; a repository setting, not code)

### Operations
- [ ] Backup and restore tested: [backup-restore-and-drills.md](backup-restore-and-drills.md)
- [ ] Monitoring deployed: [monitoring-and-alerting.md](monitoring-and-alerting.md)
- [ ] Alerting deployed: [monitoring-and-alerting.md](monitoring-and-alerting.md)
- [ ] Incident response drill completed: [backup-restore-and-drills.md](backup-restore-and-drills.md)

### Documentation
- [x] [Administrator guide](administrator-guide.md)
- [x] [Caseworker guide](caseworker-guide.md)
- [x] [Auditor guide](auditor-guide.md)
- [x] [Pilot runbook](pilot-runbook.md)
- [x] [Shutdown procedure](shutdown-procedure.md)
- [x] [Privacy notice](privacy-notice.md) (draft)
- [x] [Consent form](consent-form.md) (draft)

### Governance
- [ ] Legal review
- [ ] Privacy review
- [ ] Staff training: [governance-checklist.md](governance-checklist.md)
- [ ] Go/No-Go approval recorded in ledger: [governance-checklist.md](governance-checklist.md)

## Post-pilot-gate platform features (implemented)
- Executive dashboard: `GET /v1/dashboard/summary`, aggregate only.
- Program registry: six programs seeded; admins manage them.
- Ledger anchoring: pipeline built and tested; real Ethereum anchoring needs an RPC/signer, funded account and a testnet trial (open).
