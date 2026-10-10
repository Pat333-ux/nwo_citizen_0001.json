# BEAST Core (prototype)

Fastify API with a hash-chained, append-only ledger, identity and Family First workflow, role-based access, and an aggregate dashboard. **Prototype: not authorized or certified for federal or state use.** See `../docs/federal` and `../docs/indiana`.

## Run locally (Docker)

Set secrets in your shell (do not commit them):

- `POSTGRES_PASSWORD`: database password
- `MFA_KEY_HEX`: 64 hex chars, different from `PII_KEY_HEX`; encrypts TOTP secrets
- `ALERT_WEBHOOK_URL` (optional): receives JSON alerts
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

Tests that need PostgreSQL run only when `TEST_DATABASE_URL` is set and `db/001_ledger.sql` through `db/005_programs_anchors.sql` are applied.

## Layout

- `src/ledger`: ledger service, stores (memory and PostgreSQL), chain monitor
- `src/server`: Fastify app, users, cases, entry point
- `src/auth`: roles and permissions, login throttle
- `src/rules`: data-driven rules (recommendations only; humans decide)
- `db/`: migrations (ledger table is INSERT/SELECT only, enforced by triggers and grants)
- `openapi/beast-api.yaml`: draft API spec

## Operations

`GET /v1/ops/metrics` (Prometheus format), background DB/ledger health checks with alerts, `scripts/restore-check.sh` (backup/restore validation), `ops/alert-rules.yml`. See `../docs/pilot/`.

## Dashboard, programs, anchoring

- `GET /v1/dashboard/summary` (and `/dashboard`): aggregate counts only, including ledger health and MFA compliance.
- Programs (`/v1/programs`): Family First, Housing, Employment, Veteran Support, Food Security, Education are seeded. Only Family First has automated rules; other programs return no recommendations and rely on the caseworker. Adding rules for a new program requires code (a new rule set).
- Anchoring (`/v1/anchors`, admin): publishes the ledger Merkle root. By default (`LocalAnchorer`) nothing leaves the system and there is **no public proof**. Set `ETH_RPC_URL`, `ETH_ANCHOR_FROM` (and `ETH_NETWORK`) to send the root as a zero-value Ethereum transaction through a node or signer that holds the key; this service never holds a private key. `ANCHOR_INTERVAL_MS` (>= 60000) enables periodic anchoring. The Ethereum path is tested only against a mock RPC; try it on a testnet first.

## Before any pilot

Known gaps: TLS must be provided in front of the API; TOTP MFA is required but there is no PIV/CAC, Login.gov or OIDC sign-in (TOTP secrets are encrypted with `MFA_KEY_HEX`, which should come from a KMS); Ethereum anchoring is implemented but untested on a real network, and there is no SIWE; login throttle is per process; GitHub Actions workflow and the Docker run have not been exercised end to end; compliance documents are drafts needing legal and agency review.
