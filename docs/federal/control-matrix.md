# Control Implementation Matrix (initial)

Status: `Prototype` = exists in `beast/` code; `Planned` = not built; `Org` = organizational process.

| Control | Requirement | Implementation | Status |
|---|---|---|---|
| AC-2 | Account management | Identity service issues/revokes identities (`IdentityStatus`) | Planned |
| AC-3 / AC-6 | Access enforcement, least privilege | Role checks in `beast/src/auth/rbac.ts` | Prototype |
| AU-2 / AU-3 | Event logging, content | `beast/src/audit/audit.ts` structured audit events; ledger entries per state change | Prototype |
| AU-9 | Protection of audit info | Append-only ledger; DB blocks UPDATE/DELETE (`beast/db/001_ledger.sql`) | Prototype |
| AU-10 | Non-repudiation | Hash-chained ledger, planned Ethereum anchoring | Prototype |
| IA-2 / IA-5 | Authentication, authenticators | Single JWT issuer; PIV/CAC / Login.gov federation | Planned |
| SC-8 / SC-13 | Transmission confidentiality, crypto | TLS 1.2+; FIPS 140-3 validated modules in production | Planned |
| SC-28 | Protection at rest | AES-256-GCM PII encryption in `beast/src/crypto/pii.ts` | Prototype |
| SI-7 | Integrity verification | `Ledger.verify()` and scheduled verification (`beast/src/ledger/monitor.ts`) | Prototype |
| CM-2 / CM-3 | Baseline, change control | [Configuration Management Plan](configuration-management-plan.md), CI | Prototype |
| CP-2 / CP-9 / CP-10 | Contingency, backup, recovery | `docs/compliance/` backup and DR drafts, [contingency plan](contingency-plan.md) | Org |
| IR-4 / IR-6 | Incident handling and reporting | `docs/compliance/incident-response-plan.md` | Org |
| RA-5 | Vulnerability scanning | CI dependency audit, [supply chain policy](supply-chain-policy.md) | Prototype |
| SR-3 / SR-4 | Supply chain | SBOM generation in CI | Prototype |
| PT-2 / PT-3 | PII processing | [PIA](privacy-impact-assessment.md), PII classification policy | Prototype |
