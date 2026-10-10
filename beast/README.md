# BEAST Core (prototype)

Fastify API with a hash-chained, append-only ledger, identity and Family First workflow, role-based access, and an aggregate dashboard. **Prototype: not authorized or certified for federal or state use.** See `../docs/federal` and `../docs/indiana`.

## Run locally (Docker)

Set secrets in your shell (do not commit them):

- `POSTGRES_PASSWORD`: database password
- `JWT_SECRET`: 32+ random characters
- `PII_KEY_HEX`: 64 hex characters (32 random bytes), e.g. `openssl rand -hex 32`
- `POVERTY_LEVEL_MONTHLY`: program-supplied threshold used by the rules
- `BOOTSTRAP_ADMIN_PASSWORD`: 12+ characters; creates user `admin` only if no active admin exists

Then `docker compose up --build`. The API listens on port 3000; the dashboard is at `/dashboard`; health check at `/healthz`.

First steps: log in as `admin` (`POST /v1/auth/login`), create caseworker and auditor accounts (`POST /v1/users`), then the caseworker creates and verifies identities and works applications. Rotate or remove the bootstrap password after creating real admins.

## Test

    npm ci
    npm run typecheck
    npm run lint
    npm test

Tests that need PostgreSQL run only when `TEST_DATABASE_URL` is set and `db/001_ledger.sql`, `db/002_cases.sql` and `db/003_users.sql` are applied.

## Layout

- `src/ledger`: ledger service, stores (memory and PostgreSQL), chain monitor
- `src/server`: Fastify app, users, cases, entry point
- `src/auth`: roles and permissions, login throttle
- `src/rules`: data-driven rules (recommendations only; humans decide)
- `db/`: migrations (ledger table is INSERT/SELECT only, enforced by triggers and grants)
- `openapi/beast-api.yaml`: draft API spec

## Before any pilot

Known gaps: TLS must be provided in front of the API; no PIV/CAC, Login.gov or OIDC sign-in; no Ethereum anchoring or SIWE; ledger and case writes are not atomic; login throttle is per process; GitHub Actions workflow and the Docker run have not been exercised end to end; compliance documents are drafts needing legal and agency review.
