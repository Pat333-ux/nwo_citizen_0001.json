# Deployment Profile (Indiana, draft)

- **Hosting:** US-region cloud or agency-approved environment; all data in the US. TODO: agency decision.
- **Tenancy:** a dedicated environment and database per agency; no commingling with other customers.
- **Configuration:** Indiana-specific values (program names, rule thresholds, retention periods, notification contacts) live in data files and configuration, not code. Rule thresholds such as the poverty level come from the program, not from BEAST.
- **PII:** stays in the encrypted PII store inside the agency boundary. The ledger holds hashes only. Aggregated KPIs only on dashboards.
- **Access:** state staff sign in through the agency-approved identity provider; roles map to caseworker, admin, auditor.
- **Support and incident contacts:** TODO names and SLAs.
- **Environments:** dev, test, production with separate credentials and no production PII in lower environments.
