# Legal and Privacy Review Package

This is the briefing for reviewers. It is not a review and not legal advice: a qualified attorney and privacy officer must perform and sign it. Real participant data must not be handled until it is signed.

## Documents to review
- `privacy-notice.md`, `consent-form.md` (drafts)
- `docs/federal/privacy-impact-assessment.md`, `docs/federal/ssp-skeleton.md`, `docs/indiana/requirements-checklist.md`
- `docs/compliance/` policies: retention, deletion, PII classification, breach notification, access control, appeals

## Facts reviewers need
- **Data collected:** name, address, email (AES-256-GCM encrypted columns), household size, income, veteran/disability status, housing status, application status.
- **Ledger:** append-only and tamper-evident; holds identifiers, actions and status changes, never names/addresses/emails. Because it cannot be edited, deletion requests apply to the encrypted PII table, not the ledger. Reviewers should confirm this satisfies erasure obligations.
- **Anchoring:** only a hash (Merkle root) can be published externally, never personal data. Public blockchains are permanent.
- **Access:** caseworkers (cases), auditors (ledger, read-only), admins (accounts, programs; no case access). MFA mandatory; TOTP secrets encrypted with a separate key.
- **Decisions:** rules produce recommendations; humans decide; appeal route exists.
- **Not in place:** TLS termination (deployer), PIV/CAC or OIDC sign-in, FIPS-validated crypto, external security assessment, no federal or state authorization.

## Questions for counsel and privacy officer
1. Which laws apply (state benefits-privacy law, HIPAA if health data is added, FERPA for education programs, Privacy Act/federal program rules, children's data)?
2. Is the consent form sufficient, and is consent the right legal basis? Do minors/guardians need separate forms?
3. Retention periods and erasure handling given the immutable ledger.
4. Whether publishing hashes on a public chain is acceptable.
5. Data-sharing and vendor agreements (hosting, RPC provider, monitoring).
6. Breach-notification duties and timelines.
7. Liability and authority of New World Order DAO / Health and Wellbeing as the operating entity; pilot participant agreements.

## Sign-off
Legal reviewer: ______ Date: ____ Conditions: ____
Privacy reviewer: ______ Date: ____ Conditions: ____
