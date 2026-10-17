# nwo_citizen_0001.json
Root identity object for New World Order DAO Member #0001. Contains deterministic metadata, wallet anchor, governance permissions, insignia artifacts, and Beast System 3.0 module activation states for initial system registration and token minting.

---

# Beast System 3

Current Status: Pre-Alpha

## MVP Goals

- Google Login
- Member Dashboard
- AI Guidance (Gemini)
- Resource Navigation

## Technology Stack

- Frontend: React, Next.js
- Backend: Node.js, PostgreSQL (working code in `beast/`)
- AI: Gemini
- Identity: Google OAuth, MetaMask
- Infrastructure: Google Cloud, GitHub Actions

## Layout

See `docs/architecture.md` and `docs/roadmap.md`. Deployment: see `docs/cloud-setup.md` (Cloud Build trigger using `cloudbuild.yaml`). Copy `.env.example` to `.env` and never commit it. See `SECURITY.md`.
