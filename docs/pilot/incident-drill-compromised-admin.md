# Incident Drill: Compromised Administrator

**Scenario:** An attacker holds an admin's password and, possibly, a live session token. Run as a tabletop first, then technically in staging. Roles: incident lead, admin operator, auditor, scribe.

## What an attacker can and cannot do
Admins hold `user:manage`, `config:write`, `ledger:anchor`. They can create, disable and reset users and MFA, change programs and trigger anchoring. They cannot read cases or the ledger and cannot write or edit ledger entries over HTTP. Every admin action is itself written to the ledger. MFA is required, so a password alone does not log in; the realistic cases are a stolen session token (15 min lifetime), a stolen phone/TOTP seed, or a malicious insider.

## Detection signals
`beast_mfa_resets` or failed-login alerts; unexpected `user.created`, `user.password_reset`, `user.mfa_reset`, `program.*` entries in the ledger; logins at odd times.

## Response (target times)
| Step | Action | Target |
|---|---|---|
| 1 | Incident lead declares incident; scribe starts log | 0-10 min |
| 2 | A second admin disables the compromised account (`POST /v1/users/{id}/disable`; takes effect immediately even for unexpired tokens) | 15 min |
| 3 | Rotate `JWT_SECRET` (invalidates all sessions); restart | 30 min |
| 4 | Auditor pulls ledger records since last review, lists every admin-actor entry, verifies the chain and compares root with the last recorded/anchored root | 60 min |
| 5 | Reverse malicious changes: disable rogue accounts, reset passwords and MFA of affected users, disable/enable programs as needed; record each in the ledger | 2 h |
| 6 | Assess data exposure; follow `docs/compliance/breach-notification-plan.md` if PII was reached | 4 h |
| 7 | Re-enable the admin only after new password and fresh MFA enrollment; review the cause | after |
| 8 | Post-incident report within 5 days | 5 d |

If only one admin exists, step 2 is blocked: this is why at least two admins are required.

## Drill record (to complete)
Date: ____ Participants: ____ Time to disable: ____ Time to full scope: ____ Gaps found: ____ Follow-ups: ____
