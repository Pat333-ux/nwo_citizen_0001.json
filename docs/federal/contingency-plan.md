# Contingency Plan

Extends `docs/compliance/disaster-recovery-plan.md` and `backup-policy.md`.

- Roles: contingency lead, DB recovery, application recovery, communications (TODO names).
- Activation criteria: loss of database, ledger integrity failure, region outage.
- Recovery: restore, re-verify chain from genesis, compare to anchors, resume.
- Test annually and record results. RTO/RPO targets are unconfirmed (TODO).
