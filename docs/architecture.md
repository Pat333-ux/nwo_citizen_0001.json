# Architecture

Pre-alpha. Layers:

- **frontend/** – Next.js/React: auth, dashboard, resources.
- **backend/** – Node.js + PostgreSQL services: api, ai (Gemini), maps, analytics, audit. The working API, ledger, RBAC, audit and case flow live in `beast/`.
- **blockchain/** – contracts, voting, wallet (post-MVP).
- **infrastructure/** – Terraform and Docker for Google Cloud.

Auth: Google OAuth, then a signed JWT session. Secrets come from Google Secret Manager; see `.env.example`.
