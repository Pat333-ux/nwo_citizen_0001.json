# Access Control Policy

- Single authority: the Identity Service issues JWTs. No other service has its own auth system.
- Roles: `caseworker` (review assigned cases), `admin` (configuration and policy), `auditor` (read-only audit access).
- Dashboard access is read-only through APIs. No direct database connections.
- Only the Ledger service writes ledger records; other services submit events via the Ledger API.
- Database policy for the ledger: INSERT and SELECT only. UPDATE and DELETE are revoked.
- Least privilege, periodic access reviews, immediate revocation on role change or departure.
- Passwords are hashed with Argon2. Credentials and keys are never committed to source control.
