# Privacy

Collect the minimum data needed. PII is encrypted at rest and classified per `docs/compliance/pii-classification-policy.md`. Members can request deletion (`docs/compliance/data-deletion-policy.md`). Do not send PII to the AI assistant unless necessary and consented.

## Members

Members see only their own application ids and statuses. The identity link is server-side; clients never supply it. The assistant is disabled for a member until they accept the consent notice, and the text they type is sent to Google Gemini (best-effort redaction of SSNs, emails and phone numbers first) and is not logged or stored; the ledger records only the message length. Consent timestamps are stored on the user record.
