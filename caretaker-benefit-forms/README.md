# Caretaker Benefit Forms & Wyoming DAO Indiana Integration

Templates (Indiana FSSA/DFR, HUD/IHCDA, LIHEAP, CCDF, Vocational Rehabilitation, Wyoming DAO foreign registration, Web3 wallet signature addendum), a JSON Schema, and mapping rules for generating a caretaker packet.

```
node generate.mjs example_payload.json out/   # validate payload, render templates
npm test
```

- `schemas/member_onboarding_schema.json` – payload schema.
- `generation_rules.json` – scope → template/output mapping (`always` entries render for every payload).
- Output is rendered Markdown (`.pdf` names in rules become `.md`); convert to PDF with your tool of choice.

**Important:** templates are drafts, not official agency forms, and not legal advice. Verify current official form wording and e-signature/DAO requirements with the agencies and counsel before real use. Payloads contain PII; never commit real data (`out/` is ignored).

## Workflow, monitoring and webhook

`workflow_engine.mjs` tracks `workflow_state` (DRAFT → FORMS_GENERATED → PAUSED_AWAITING_GOVERNMENT_VERIFICATION → VERIFIED_APPROVED / ACTION_REQUIRED_DEFICIENCY → EXPIRED_RENEWAL_REQUIRED). Illegal transitions throw. The workflow is verified only when every agency implied by `authorized_scopes` has approved; any denial or more-info response moves it to `ACTION_REQUIRED_DEFICIENCY`. `runComplianceAudit()` expires approvals past `annual_re_certification_due` (run it from cron).

Webhook listener: `WEBHOOK_SECRET=... node workflow_engine.mjs payload.json 8787`, then `POST /webhook/government-response` with `{agency,status,reference_id,notes}` and header `X-Signature` = hex HMAC-SHA256 of the raw body. Agencies (FSSA, IHCDA, HUD) do not natively push to this format, so in practice responses are entered manually or via an intermediary you build. Run it behind TLS.
