# Supply Chain and Vulnerability Policy

- Minimize dependencies; prefer Node built-ins. Pin versions via lockfile.
- CI runs a dependency audit and generates an SBOM (CycloneDX) on each change.
- Critical/High vulnerabilities: remediate within 15 days (TODO: align with agency requirements); Moderate within 30.
- New dependencies are checked against the GitHub Advisory Database before adoption.
- Container images (when added) use minimal base images and are scanned before release.
