# Threat Model

| Threat | Mitigation |
|---|---|
| Leaked secrets | Secret Manager, GitHub Secrets, quarterly rotation, secret scanning |
| Account takeover | Google OAuth, MFA, short-lived JWTs |
| API key abuse | Restrict keys by API and origin |
| Prompt injection / data leakage via AI | Server-side calls, no secrets or PII in prompts |
| Privilege misuse | RBAC and audit log of all privileged actions |
| Supply chain | Dependabot, `npm audit` in CI |
