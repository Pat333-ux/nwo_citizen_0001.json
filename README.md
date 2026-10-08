# nwo_citizen_0001.json
Root identity object for New World Order DAO Member #0001. Contains deterministic metadata, wallet anchor, governance permissions, insignia artifacts, and Beast System 3.0 module activation states for initial system registration and token minting.

## munisible_task_force_governance_84.json

**Purpose:**  
Defines the governance framework for the Munisible Task Force as a voluntary, privacy-preserving community wellbeing module.

**Key sections:**
- `mission`: High-level purpose and ethical stance.
- `scope`: Municipal → county → state → DAO boundaries.
- `privacy_protocols`: Voluntary participation, anonymization, and aggregate-only data.
- `routing_rules`: How wellbeing signals are routed into services and governance.
- `modules`: Intake, signal processing, routing, referrals, and ledger anchoring.
- `dao_compliance`: Audit controls and alignment with LUCR stability.

**Consumption pattern:**
- The assistance routing engine reads:
  - `privacy_protocols` to enforce privacy and consent constraints.
  - `routing_rules` to select service paths.
  - `dao_compliance` to record governance compliance checks in the ledger.
- Routing and ledger records contain aggregate, non-identifying information only.

## System law and opinion engine

- `system_law_constitution_001.json` defines the deterministic privacy, consent, wellbeing, routing, audit, and ledger rules.
- `system_opinion_engine_001.json` evaluates aggregate signals and routing compliance using explicit rules grounded in the constitution and Document 84.
- `dao_audit_hooks_001.json` flags privacy violations, critical opinions, and audit-required opinions for quarterly DAO review.
- The assistance routing engine evaluates audit hooks before ledger writes and references these governance artifacts. Opinions are rule-based evaluations and recommendations; they do not enable individual profiling or surveillance.
- The assistance routing envelope carries `system_opinion` with an evaluation, triggered rule basis, supporting envelope fields, recommended action, severity, and DAO alignment flags.
- Program 300 governance is configured in the assistance router: municipal routing enforces System Law and Document 84; county escalation is limited to warning/critical opinions or audit-required opinions; state escalation requires an opinion and a triggered audit hook.

## Governance envelope lifecycle

1. Validate privacy, consent, aggregation (minimum aggregate count: 10), and human-origin verification before routing. Failures use a fixed reason precedence; rejection envelopes omit raw data and sub-threshold counts.
2. Route validated aggregate signals deterministically through municipal, county, and state layers. Federal review validates state escalations and checks LUCR stability impact; DAO reconciliation ingests quarterly audit outcomes.
3. Generate the rule-based system opinion and evaluate DAO audit hooks, including privacy/consent violations, critical opinions, audit-required opinions, LUCR instability, and municipal hazards.
4. Anchor accepted and rejected envelopes with their governance document, audit cycle, flags, and deterministic hash. The routing contract specifies RFC 8785 JSON canonicalization and SHA-256, excludes the hash and envelope ID fields from the hashed payload, and marks ledger records immutable.

## TypeScript runtime

`src/wellbeing-pipeline.ts` implements validation, routing, opinion, audit-hook, envelope-finalization, and local ledger stages against the governance JSON files. It exports `processWellbeingSignal` and the standalone `validateSignal`, `routeSignal`, `evaluateOpinion`, `applyAuditHooks`, and `writeToLedger` services, along with the corresponding signal, configuration, and envelope interfaces. Per-signal primary paths, secondary paths, DAO-review defaults, and escalation levels are configured by `routing_rules.signal_routes` in Document 84. Node.js 22.6 or later is required for built-in TypeScript stripping; run `npm test` for the runtime tests.

Call `processWellbeingSignal(signal, { ledgerDir })` with the required signal fields: `signal_type`, `aggregate_count`, `consent_flag`, `contains_personal_identifiers`, `aggregate_only`, and `human_origin`. `validateSignal(signal, law, doc84, minimumAggregateCount?)` is also exported; it applies the System Law privacy/consent rules and requires a positive count, the configured minimum count, and a signal type listed in Document 84. Document 84's `allowed_signal_types` is the routing allowlist. Rejection reasons follow the configured privacy → consent/origin → aggregate → signal-type precedence. The optional `lucr_stability` input accepts `stable`, `degrading`, or `improving`.

The pipeline persists redacted, hash-addressed JSON records under `.beast3-ledger/` by default (or a caller-supplied `ledgerDir`). Records are created without overwrite, set read-only, and can be checked with `ImmutableFileLedger.verify`. This is local, tamper-evident file storage—not a distributed or administrator-proof immutable ledger—and the runtime does not contact municipal agencies, deliver referrals, or perform DAO governance actions.
