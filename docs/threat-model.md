# Threat Model

| Threat | Mitigation |
|---|---|
| Leaked secrets | Secret Manager, GitHub Secrets, quarterly rotation, secret scanning |
| Account takeover | Google OAuth, MFA, short-lived JWTs |
| API key abuse | Restrict keys by API and origin |
| Prompt injection / data leakage via AI | Server-side calls, no secrets or PII in prompts |
| Privilege misuse | RBAC and audit log of all privileged actions |
| Supply chain | Dependabot, `npm audit` in CI |

## Member role

| Threat | Mitigation |
|---|---|
| Member reads/changes another member's data | Identity taken from the token's user record; ownership checked on every `/me` route; foreign ids return 404; tests cover it |
| Account takeover of a member | Google-only sign-in, no password; 15-minute sessions; disabling a user takes effect immediately |
| Self-provisioned or guessed accounts | No auto-creation; staff create members for verified identities only; unique email and identity links |
| Abuse of assistant/Maps quota by public users | Stricter per-user and per-IP rate limits; assistant gated by consent |
| Privilege escalation | Member role has only self-scoped permissions; DB constraint ties role `member` to an identity and staff roles to none |
| In-memory rate limits are per instance | Use a shared store (Redis/Postgres) or cap Cloud Run instances before wide release |
