# Google Cloud setup (Milestone 2)

Order: Project → Gemini API → Maps API → OAuth credentials → dashboard development.

1. Create a project and enable billing (console).
2. Run `PROJECT_ID=<id> ./infrastructure/setup-gcp.sh` (or `terraform apply -var project_id=<id>` in `infrastructure/terraform`) to enable APIs and create Secret Manager entries.
3. Complete the manual steps the script prints (Gemini key, Maps key restriction, OAuth consent screen + client). Google does not allow creating standard web OAuth clients via CLI.
4. Local dev: copy `.env.example` to `.env` and fill values; never commit `.env`.
5. Restrict API keys, enable MFA, rotate quarterly (see `SECURITY.md`).

## Continuous deployment (Cloud Build → Cloud Run)

Deployment currently runs from this repository (`Pat333-ux/nwo_citizen_0001.json`) using the root `cloudbuild.yaml`, which builds `beast/` and deploys it to Cloud Run.

1. Create the registry once: `gcloud artifacts repositories create beast --repository-format=docker --location=us-central1`
2. Create the Secret Manager entries `JWT_SECRET`, `DATABASE_URL`, `PII_KEY_HEX` and grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor`.
3. Grant the Cloud Build service account `roles/run.admin`, `roles/iam.serviceAccountUser` and `roles/artifactregistry.writer`.
4. Console → Cloud Build → Triggers → Connect repository (GitHub app) → select this repo.
5. Create the trigger:
   ```
   gcloud builds triggers create github --name=beast-system-deploy-trigger \
     --repo-owner=Pat333-ux --repo-name=nwo_citizen_0001.json \
     --branch-pattern='^main$' --build-config=cloudbuild.yaml
   ```
6. Register the Cloud Run URL printed by the first deploy in the OAuth client's authorized origins and redirect URIs.

### Moving to a separate repo later
Before real member data is handled, move the Beast System 3 folders to a new **private** repo (`beast-system-3.0`) without the `nwo_*.json` and `nwo-citizen0001-*.json` identity files, rewrite the README, then re-point the trigger.

## Google sign-in (API)

Set `GOOGLE_OAUTH_CLIENT_ID` on the Cloud Run service to enable `POST /v1/auth/google`. The frontend obtains a Google ID token (Google Identity Services) and posts `{ "idToken": "..." }`; the API verifies signature, issuer, audience, expiry and verified email, then issues the normal session token. Accounts are not auto-created: an admin links an existing user to a Google email with `POST /v1/users/:id/email`. Apply `beast/db/004_user_email.sql` to the database first.

## First production deploy checklist

1. Secrets exist in Secret Manager: `JWT_SECRET`, `DATABASE_URL`, `PII_KEY_HEX` (64 hex chars: `openssl rand -hex 32`). Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor`.
2. Apply the database migrations: `DATABASE_URL=... beast/db/apply.sh` (through the Cloud SQL Auth Proxy for Cloud SQL). This includes `004_user_email.sql`.
3. On the Cloud Build trigger, set substitutions `_POVERTY_LEVEL_MONTHLY` (required), `_GOOGLE_OAUTH_CLIENT_ID` and `_CLOUDSQL_INSTANCE` (if using Cloud SQL).
4. Push to `main`. Verify: `GET /healthz` returns `{"ok":true}`; password login works; then Google sign-in for one admin-linked user (`POST /v1/users/:id/email`, then `POST /v1/auth/google`).
5. `--allow-unauthenticated` is the default because the API enforces its own login. Set `_AUTH_FLAG=--no-allow-unauthenticated` to require Google IAM as well.

## Gemini assistant and resource locator

Once the base deploy works and the keys are stored in Secret Manager, append `,GEMINI_API_KEY=GEMINI_API_KEY:latest,GOOGLE_MAPS_API_KEY=GOOGLE_MAPS_API_KEY:latest` to the `_SECRETS` substitution. The endpoints exist only when the corresponding key is present:

- `POST /v1/assistant {message}` (caseworker, admin): rate limited to 10/min per user. Obvious SSNs, emails and phone numbers are redacted before the text is sent; the message text is never logged, and the ledger records only its length. Redaction is best effort, so tell users not to enter personal details. Optional `GEMINI_MODEL`.
- `GET /v1/resources?near=...&category=food|housing|healthcare|childcare|energy|employment|legal`: Google Places (New) is called server-side, results cached 10 minutes, 30/min per user. Requires the Places API (New), `places.googleapis.com`, which the setup script and Terraform enable.

These are staff-role endpoints. A member-facing role and the Next.js frontend are not built yet.
