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

### Local HTTP service

Run `npm start` from the repository root with `BEAST3_API_KEY` set. The service loads and checks System Law, Document 84, the routing artifact, Opinion Engine, and DAO audit hooks before binding to `127.0.0.1:3000`; a configuration failure prevents startup. The bearer API key is mandatory for all endpoints except health. Set `HOST`, `PORT`, `BEAST3_CONFIG_DIR`, `BEAST3_LEDGER_DIR`, `BEAST3_QUEUE_DIR`, and `BEAST3_AUDIT_REPORT_DIR` to configure paths. The default loopback binding is intentional. Use `BEAST3_ALLOWED_IPS` as a comma-separated IP allowlist and configure TLS/mTLS at a trusted reverse proxy before external exposure. No proxy-forwarded client IP headers are trusted.

- `POST /signals` accepts one signal; `POST /signals/batch` accepts an ordered JSON array (maximum 100). Requests are validated, enqueued durably, and return HTTP 202 with queue job IDs. Poll `GET /jobs/:uuid` for completion, the envelope hash, and outbound delivery outcomes.
- The bounded file queue defaults to `.beast3-queue/`, mode-restricted to the service account, and returns HTTP 503 with `Retry-After` on capacity exhaustion. Rejected signals have sub-threshold counts, unrecognized types, and unnecessary LUCR fields redacted before queue persistence. A single locked consumer runs in the service process; restart recovery requeues in-progress jobs. Do not run multiple service instances against the same queue directory.
- Request bodies are capped at 64 KiB. `BEAST3_MAX_QUEUE_SIZE`, `BEAST3_RATE_LIMIT_MAX_REQUESTS`, and `BEAST3_RATE_LIMIT_WINDOW_MS` configure queue capacity and the per-IP request window.
- `GET /health` reports readiness. Protected `GET /metrics` returns process-local aggregate counts, validation rejection reasons, opinion rule-basis counts, outbound outcomes, and average/maximum stage timings; metrics reset on restart.
- Protected `GET /ledger/:sha256` retrieves a record only when its content hash verifies; `GET /ledger/:sha256/verify` reports verification status.

The service schedules UTC quarterly reports under `.beast3-audit/`. Each report only includes hash-verified envelopes requiring DAO review and summarizes signal type, severity, LUCR impact, routing layers, and escalation counts in JSON and Markdown. The scheduler runs while the service is active; missed quarters during downtime are not automatically backfilled.

Optional outbound HTTPS targets are configured with `BEAST3_TARGET_FOOD`, `BEAST3_TARGET_SHELTER`, `BEAST3_TARGET_MEDICAL`, `BEAST3_TARGET_SOCIAL_SERVICES`, and `BEAST3_TARGET_COMMUNITY_ORGS`. Adapters send only allowed signal type, aggregate count, destination service path, and escalation level; they reject non-HTTPS URLs and never send consent/origin flags or raw request fields. Delivery uses a queue-job idempotency key, a five-second timeout, and records only a fixed delivery status/error code. Targets must be operator-controlled HTTPS APIs; integrations, email delivery, partner authentication, and agency-side behavior are deployment-specific.

Set `BEAST3_REPLICA_DIR` to enable a second hash-verified local filesystem copy and periodic integrity checks. This is not cloud/object-store replication, distributed consensus, or an administrator-proof ledger. Routing remains local deterministic policy evaluation; no external DAO reconciliation occurs. IP allowlisting and in-memory rate limiting are basic controls, not a substitute for a TLS-terminating gateway, robust identity management, or distributed abuse protection.
