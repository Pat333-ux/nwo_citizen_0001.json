# System Security Plan (Skeleton)

1. **System name:** BEAST 3.0 (TODO: official name/ID)
2. **Categorization (FIPS 199):** proposed Moderate (confidentiality: Moderate, integrity: High for ledger, availability: Moderate). TODO: confirm with the agency.
3. **System owner / AO / ISSO:** TODO
4. **Deployment model:** TODO (cloud service vs. on-premises)
5. **Boundary and data flow:** see [data-flow-and-boundary.md](data-flow-and-boundary.md)
6. **Components:** Identity service (JWT issuer), Ledger service (sole ledger writer), Family First, Dashboard (read-only), PostgreSQL, secure PII store.
7. **Controls:** see [control-matrix.md](control-matrix.md); baseline NIST SP 800-53 Rev. 5 Moderate.
8. **Interconnections:** TODO
9. **Policies and plans:** see `docs/compliance/` and this directory.
10. **POA&M:** TODO, maintained after assessment.
