# Monitoring and Alerting (requirements)

Nothing is deployed yet; this specifies what to deploy.

## Signals
- `/healthz` uptime probe (1 min interval).
- Scheduled `/v1/ledger/verify` (every 15 min) using an auditor service credential.
- Ledger root change that is not a prefix extension.
- Failed login spikes (login throttle is per process).
- HTTP 5xx rate, latency, DB connections, disk space, backup job success.

## Alerts
| Condition | Severity | Notify |
|---|---|---|
| Ledger verify fails | Critical | On-call + pilot lead, immediately |
| Health down 3 min | High | On-call |
| Failed-login spike | Medium | Admin |
| Backup missed | High | Admin |

Test every alert once before go-live and record the evidence.
