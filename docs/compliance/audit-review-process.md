# Audit Review Process

- Auditors have read-only access to the ledger, access logs and aggregate KPIs.
- Quarterly: verify the full hash chain (`currentHash = sha256(previousHash + sequence + timestamp + action + actor + payloadHash)`) from `BEAST_GENESIS_2026`, and compare it with Ethereum anchors.
- Review samples of decisions: confirm a human reviewer, a rule reason, and a matching ledger entry.
- Review access control, retention and deletion activity.
- Findings are reported to admins, tracked to closure, and the review itself is recorded in the audit log.
