# Configuration Management Plan

- All changes via pull request with review; CI must pass (tests, dependency audit, SBOM).
- Baseline: Git history plus the dependency lockfile; database changes via numbered SQL migrations in `beast/db/`.
- Ledger schema changes must never grant UPDATE/DELETE.
- Security impact analysis is required for changes to authentication, ledger, or PII handling.
- Releases are tagged; container images (when added) are built in CI and scanned.
