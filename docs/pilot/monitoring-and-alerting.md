# Monitoring and Alerting

## Implemented in code
- `GET /v1/ops/metrics` (admin or auditor): Prometheus text with `beast_failed_logins`, `beast_mfa_failures`, `beast_mfa_resets`, `beast_ledger_verify_failures`, `beast_anchor_failures`, `beast_db_check_failures`, and gauges `beast_db_up`, `beast_ledger_valid`. Counters are per process and reset on restart; use `increase()` in rules. No PII.
- A background check (every `HEALTH_INTERVAL_MS`, default 60 s) pings the database and verifies the ledger. Failures emit a JSON `{"alert":true,"severity":...}` log line and, if `ALERT_WEBHOOK_URL` is set, a JSON POST (Slack-style `text` field included). Anchor failures alert at severity high.
- Example rules: `ops/alert-rules.yml`.

## Still to do by operators (not verifiable from code)
1. Deploy Prometheus (or equivalent) and an alert route to a staffed channel; give it an auditor service account with MFA.
2. Add external probes for `/healthz` and TLS expiry, plus host metrics (disk, CPU, memory) and backup-job success.
3. Test each alert once (stop the DB, tamper a copy of the ledger, fail a login burst, reset MFA on a test user) and record evidence.
4. Log shipping with retention per the retention policy, because per-process counters are lost on restart.

| Condition | Severity | Notify |
|---|---|---|
| DB unreachable, ledger verify fails | Critical | On-call + pilot lead immediately |
| Anchor failure | High | On-call |
| Failed-login spike, MFA reset | Medium | Admin / security lead |
