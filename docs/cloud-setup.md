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
