import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIdempotencyKey,
  runStagedPrototype,
  validateEventShape,
  type CitizenPrototypeConfig,
  type DefiExchangeEvent,
  type GateChecks
} from "../src/prototype/defiTriggerPrototype.ts";

const config: CitizenPrototypeConfig = {
  citizen_id: "NWO-0001",
  defi_triggers: { enabled: true, require_finality: true },
  benefits_orchestration: { autoSubmit: false, target_domains: ["fssa_indiana", "civic_aid", "grants"] }
};

const event: DefiExchangeEvent = {
  event: "defi.exchange.triggered",
  chainId: 1,
  txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  logIndex: 0,
  citizen_id: "NWO-0001",
  tokenIn: "LUCR",
  tokenOut: "USDC",
  amountIn: "100",
  amountOut: "100",
  finalized: true,
  timestamp: "2026-11-22T23:57:00.000Z"
};

const openGates: GateChecks = {
  emergencyClear: true,
  policyApproved: true,
  piiScrubbed: true,
  citizenConsentGiven: true
};

test("builds deterministic idempotency keys", () => {
  assert.equal(buildIdempotencyKey(event), "1:0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef:0:NWO-0001");
});

test("blocks malformed event payloads", () => {
  const result = runStagedPrototype(config, { ...event, txHash: "" }, openGates, new Set());
  assert.equal(result.status, "blocked");
  assert.match(result.reason ?? "", /Missing txHash/);
  assert.deepEqual(validateEventShape({ ...event, txHash: "" }), ["Missing txHash"]);
});

test("blocks unconfirmed finality and every safety gate", () => {
  assert.equal(runStagedPrototype(config, { ...event, finalized: false }, openGates, new Set()).status, "blocked");
  assert.equal(runStagedPrototype(config, event, { ...openGates, emergencyClear: false }, new Set()).status, "blocked");
  assert.equal(runStagedPrototype(config, event, { ...openGates, policyApproved: false }, new Set()).status, "blocked");
  assert.equal(runStagedPrototype(config, event, { ...openGates, piiScrubbed: false }, new Set()).status, "blocked");
  assert.equal(runStagedPrototype(config, event, { ...openGates, citizenConsentGiven: false }, new Set()).status, "blocked");
});

test("stages prefill actions but never enables auto-submit", () => {
  const seen = new Set<string>();
  const result = runStagedPrototype(config, event, openGates, seen);
  assert.equal(result.status, "staged");
  assert.equal(result.autoSubmit, false);
  assert.equal(result.stagedActions.length, 3);
  assert.ok(result.stagedActions.every((action) => action.action === "evaluate_and_prefill_only" && action.requiresManualApproval));

  const duplicate = runStagedPrototype(config, event, openGates, seen);
  assert.equal(duplicate.status, "duplicate");
});
