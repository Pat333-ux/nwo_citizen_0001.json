# Auditor Guide (draft)

Role `auditor`: `ledger:read`, `kpi:read` (read-only).

## Verify the ledger
- `GET /v1/ledger/verify`: recomputes the hash chain; expect success. Any failure is an incident.
- `GET /v1/ledger/root`: Merkle root. Record it at each review and compare with the prior value; the earlier chain must be unchanged.
- `GET /v1/ledger/records`: inspect entries for the review period: actor, action, timestamps, unexpected gaps.

## Review checklist
- Every decision has a caseworker actor and reason.
- No admin or unknown actors on case records.
- Account additions match approved requests.
- Record findings and the root hash in the audit log per `docs/compliance/audit-review-process.md`.
