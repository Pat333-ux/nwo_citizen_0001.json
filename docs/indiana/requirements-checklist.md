# Requirements and Verification Checklist

Status: `Draft` = addressed in repo docs/code; `Open` = needs work or confirmation. Every "Verify" item needs counsel/agency confirmation.

| Area | Item | BEAST status | Verify |
|---|---|---|---|
| Security | IOT security standards and agency review | Open | Obtain the current IOT policies |
| Security | GovRAMP (formerly StateRAMP) or equivalent for cloud | Open | Level required by agency |
| Security | NIST SP 800-53 mapping | Draft (`docs/federal/control-matrix.md`) | |
| Privacy | Indiana fair information practices and public-agency data rules | Draft (PIA) | Applicable Indiana Code sections |
| Privacy | Public records access law applicability to records held for an agency | Open | Counsel |
| Breach | Indiana breach disclosure statute and agency notice terms | Draft (`docs/compliance/breach-notification-plan.md`) | Notification deadlines and contacts |
| Data | Data residency (US), ownership, return and deletion at contract end | Draft (deletion policy) | Contract terms |
| Federal programs | IRS Pub 1075 (tax info), HIPAA, CJIS, program rules for SNAP/Medicaid/TANF | Open | Depends on data in scope |
| Accessibility | WCAG 2.1 AA / Section 508 for the dashboard | Open (no UI yet) | State accessibility policy |
| Identity | State-approved identity proofing and sign-in | Open | Agency requirement |
| Records | Retention schedules for state records | Draft (retention policy uses placeholders) | Indiana archives schedules |
| Audit | Audit logging and ledger verification | Draft/Prototype | |
| Continuity | Backup, DR, contingency | Draft | Agency RTO/RPO |
| Appeals | Applicant appeal and fair-hearing rights for benefit decisions | Draft (`docs/compliance/appeal-process.md`) | Program fair-hearing rules; the draft process may not satisfy these |
| Human review | No automated denials; caseworker decision | Prototype (rules engine returns recommendations only) | Program rules |
