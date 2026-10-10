# Continuous Monitoring Plan

- Ledger chain verification runs on a schedule (`beast/src/ledger/monitor.ts`); any failure is a High severity incident.
- Dependency and container vulnerability scans run in CI and weekly.
- Audit events are reviewed per the Audit Review Process.
- Monthly: access review and vulnerability status report. Annually: control review and DR exercise.
- TODO: log aggregation and alerting tooling.
