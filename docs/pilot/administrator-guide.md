# Administrator Guide (draft)

Role `admin` has `user:manage`, `config:write`, `kpi:read`. Admins cannot read cases or the ledger.

## Setup
1. Set secrets in the environment, never in git: `POSTGRES_PASSWORD`, `JWT_SECRET` (32+ chars), `PII_KEY_HEX` (64 hex chars), `POVERTY_LEVEL_MONTHLY`, `BOOTSTRAP_ADMIN_PASSWORD` (12+ chars).
2. Apply `beast/db/001_ledger.sql`, `002_cases.sql`, `003_users.sql`, then `docker compose up --build` in `beast/`.
3. Put TLS in front of the API. Check `GET /healthz`.
3a. Apply `004_mfa.sql` too (compose does this automatically).
4. Log in as `admin` (`POST /v1/auth/login`), create named accounts with `POST /v1/users`, then rotate or remove the bootstrap password.

## Routine
- Create one account per person; never share accounts. Use `GET /v1/users` to review accounts monthly and deactivate leavers.
- Grant the least role needed (caseworker, auditor, admin). Keep at least two admins.
- Rotate `JWT_SECRET` on suspected compromise (this logs everyone out). Never rotate `PII_KEY_HEX` without a migration plan; it makes existing PII unreadable.
- Do not edit the ledger. It is append-only by database triggers and grants.

## Escalation
Follow `docs/compliance/incident-response-plan.md`.

## MFA
Every account must enroll TOTP on first login: log in, `POST /v1/auth/mfa/enroll` (returns `secret` and `otpauthUri` for an authenticator app), then `POST /v1/auth/mfa/confirm` with a code. Log in again with `otp` in the login body. For a lost device, `POST /v1/users/{id}/mfa/reset`, then the user re-enrolls. The bootstrap admin must enroll before doing anything else.
