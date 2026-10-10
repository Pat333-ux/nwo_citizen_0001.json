# BEAST 3.0 Pilot Gate

Drafts for a small supervised Family First pilot. Not legal advice; every document needs owner review and sign-off. Prototype: not authorized or certified for federal or state use.

## Gate status

Code items below are verified against `beast/` as of this document; everything else is open until evidence is attached.

### Security
- [x] Ledger atomicity
- [x] User atomicity
- [ ] Ledger lockdown. Finding: the API exposes only `GET /v1/ledger/records`, `/verify`, `/root` (auditor role); there is no HTTP ledger write route. Remaining: confirm DB role grants (INSERT/SELECT only) in the target environment and that no other network path reaches Postgres.
- [ ] MFA for all staff roles. Not implemented in `beast/src/auth`. Needs code (TOTP or OIDC provider with MFA) plus tests.
- [ ] Threat-model review: see [threat-model.md](threat-model.md)
- [ ] Audit verification: see [auditor-guide.md](auditor-guide.md)

### Database
- [ ] PostgreSQL validation (CI job `test` runs DB tests against postgres:16)
- [ ] Concurrent-write testing (needs new tests)
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
