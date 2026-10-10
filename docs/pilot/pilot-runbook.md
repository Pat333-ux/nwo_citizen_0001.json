# Pilot Runbook (draft)

## Pilot limits
Small supervised cohort, named staff only, administrative oversight, weekly review.

## Preconditions (all required)
All gate items in [README.md](README.md) checked; Go/No-Go recorded.

## Launch
1. Deploy, apply migrations, verify `/healthz` and `/v1/ledger/verify`.
2. Take and test-restore a backup.
3. Confirm monitoring and alerts fire (see [monitoring-and-alerting.md](monitoring-and-alerting.md)).
4. Create staff accounts; confirm training completed.

## Daily
Check health, alerts, ledger verify result, failed-login volume.

## Weekly
Auditor review and root hash record; admin account review; pilot lead review of KPIs and appeals.

## Stop conditions
Ledger verify failure, confirmed data breach, unexplained participant harm, loss of backups, or lead decision: invoke [shutdown-procedure.md](shutdown-procedure.md).
