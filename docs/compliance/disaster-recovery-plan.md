# Disaster Recovery Plan

- Targets: RTO 4 hours, RPO 15 minutes (to be confirmed by admin).
- Recovery order: database → Identity Service → Ledger service → Family First → Dashboard.
- Steps: declare disaster → provision infrastructure (Docker images via GitHub Actions) → restore from backup → verify ledger chain integrity → resume services → post-event review.
- The Ethereum anchor layer is used to confirm the restored ledger matches previously anchored hashes.
- Run a DR exercise at least annually.
