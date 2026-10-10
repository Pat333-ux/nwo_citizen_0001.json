# Threat Model (draft for review)

| Threat | Mitigation present | Gap |
|---|---|---|
| Ledger tampering | Hash chain, Merkle root, INSERT/SELECT-only grants and triggers | Anchor roots externally; scheduled verify |
| Ledger write endpoint abuse | HTTP write route removed (tested) | Confirm DB access is network-restricted |
| Stolen staff credentials | Login throttle, JWT, RBAC, mandatory TOTP MFA with replay protection and encrypted TOTP secrets | Throttle per process; MFA key in an environment variable (move to a KMS) |
| Privilege escalation | Role grants in `rbac.ts`; admin cannot read cases | Review `user:manage` abuse via audit |
| PII exposure | PII encryption (`PII_KEY_HEX`) | Key management and rotation plan |
| Insider misuse | Audit trail | Regular auditor review |
| Injection / dependency risk | CI audit, SBOM | Required CI enforcement |
| Transport interception | Needs TLS proxy | Not enforced by the app |
| Availability loss | Backups documented | Untested restore |

Reviewer sign-off: ______ Date: ______
