# NWO-0001 DeFi Prototype Dry-Run

Generated: 2026-11-22

## Scope

- Branch: `feat/nwo-0001-defi-prototype`
- Mode: staged-only
- `autoSubmit`: `false`
- External dispatch: not implemented
- External application submission: not implemented
- Secrets: none added

## Safety invariants

- DeFi triggers are disabled by default.
- Events require confirmed finality.
- Repeated deliveries are rejected by `${chainId}:${txHash}:${logIndex}:${citizen_id}`.
- Emergency pause, constitutional policy, PII scrubbing, and citizen consent must all pass.
- Benefits actions are limited to `evaluate_and_prefill_only` and require manual approval.

## Requested validation

The prototype test suite covers:

- deterministic idempotency keys
- malformed payload rejection
- non-finalized transaction blocking
- emergency pause blocking
- policy rejection
- PII gate rejection
- citizen consent rejection
- staged payload generation
- duplicate event rejection

## Not implemented

- Live relayer or webhook verification
- HMAC or signature verification
- Persistent idempotency storage
- Cross-repository fan-out
- Government or financial submission
- Secret-backed RPC or API credentials

## Before runtime enablement

1. Integrate and verify the real webhook/HMAC contract.
2. Verify the emergency and policy service interfaces.
3. Add durable idempotency and append-only audit persistence.
4. Validate qualification and consent per target program.
5. Keep staged review and explicit per-program approval as required gates.
