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
