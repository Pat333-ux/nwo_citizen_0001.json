#!/usr/bin/env bash
# Usage: PROJECT_ID=my-project ./infrastructure/setup-gcp.sh
# Requires: gcloud (logged in: `gcloud auth login`), billing enabled on the project.
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"
gcloud config set project "$PROJECT_ID"

gcloud services enable generativelanguage.googleapis.com maps-backend.googleapis.com \
  places-backend.googleapis.com secretmanager.googleapis.com

for s in GEMINI_API_KEY GOOGLE_MAPS_API_KEY GOOGLE_OAUTH_CLIENT_ID GOOGLE_OAUTH_CLIENT_SECRET JWT_SECRET DATABASE_URL; do
  gcloud secrets describe "$s" >/dev/null 2>&1 || gcloud secrets create "$s" --replication-policy=automatic
done

# JWT secret can be generated locally.
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add JWT_SECRET --data-file=-

# Maps key restricted to the Maps/Places APIs. Add --allowed-referrers after you have a domain.
gcloud services api-keys create --display-name="beast-maps" \
  --api-target=service=maps-backend.googleapis.com --api-target=service=places-backend.googleapis.com

cat <<'M'

Done. Remaining manual steps (cannot be scripted):
1. Gemini key: https://aistudio.google.com/apikey -> then
   printf '%s' "KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-
2. Maps key: copy the keyString of the key created above (gcloud services api-keys list/get-key-string),
   restrict by HTTP referrer in the console, store as GOOGLE_MAPS_API_KEY.
3. OAuth: Console > APIs & Services > OAuth consent screen, then Credentials > Create OAuth client ID (Web).
   Redirect URI e.g. http://localhost:3000/api/auth/callback/google for dev. Store client ID/secret as secrets.
4. DATABASE_URL: store your PostgreSQL URL.
Never paste keys into git or chat.
M
