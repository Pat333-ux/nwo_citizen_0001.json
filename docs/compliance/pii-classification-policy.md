# PII Classification Policy

## Classes
| Class | Examples | Storage |
|---|---|---|
| Restricted PII | Name, address, email, SSN, income records, veteran/disability status | Secure PII store only, encrypted at rest (`IdentityPII`) |
| Internal | Identity status, verification level, reputation | Identity service database |
| Public / Ledger-safe | DIDs, hashes, action names, timestamps, aggregate KPIs | Ledger, blockchain anchors, dashboard |

## Rules
- No PII enters the ledger or any blockchain anchor. Ledger records carry only `payloadHash`.
- PII is stored separately from the shared `BeastIdentity` record and linked only by `identityId`.
- Dashboards show aggregates only: no specific family data, veteran names, income records or SSN data.
- New data fields must be classified before they are added to any schema.
