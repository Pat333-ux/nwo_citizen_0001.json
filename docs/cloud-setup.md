# Google Cloud setup (Milestone 2)

Order: Project → Gemini API → Maps API → OAuth credentials → dashboard development.

1. Create a project and enable billing (console).
2. Run `PROJECT_ID=<id> ./infrastructure/setup-gcp.sh` (or `terraform apply -var project_id=<id>` in `infrastructure/terraform`) to enable APIs and create Secret Manager entries.
3. Complete the manual steps the script prints (Gemini key, Maps key restriction, OAuth consent screen + client). Google does not allow creating standard web OAuth clients via CLI.
4. Local dev: copy `.env.example` to `.env` and fill values; never commit `.env`.
5. Restrict API keys, enable MFA, rotate quarterly (see `SECURITY.md`).
