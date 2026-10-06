import test from "node:test";
import assert from "node:assert/strict";
import { processMember } from "../src/pipeline/index.ts";
import { beastIntegration } from "../src/pipeline/beast-hook.ts";
import { computeSignature } from "../src/pipeline/signature.ts";
import { clearLog, getLog } from "../src/pipeline/log.ts";

const TS = "2026-10-06T00:00:00.000Z";
const member = { id: "0001", name: "A", tax: { owesIRS: true, ssnLast4: "1234", balanceOwed: 100 } };

test("envelope structure", () => {
  const [p] = processMember(member, TS);
  const env = beastIntegration(p, TS);
  assert.equal(env.envelopeId, `${p.programId}-0001`);
  assert.equal(env.signature, p.signature);
  assert.deepEqual(env.route, { target: "beast-system-3.0", priority: "standard", timestamp: TS });
  assert.equal(env.payload, p);
  assert.equal(env.status, "ready-for-routing");
});

test("signature is sha256 hex and matches recomputation", () => {
  const [p] = processMember(member, TS);
  assert.match(p.signature, /^[0-9a-f]{64}$/);
  assert.equal(p.signature, computeSignature(p, TS));
});

test("deterministic for same input; changes with input", () => {
  const a = processMember(member, TS).map(p => p.signature);
  const b = processMember(member, TS).map(p => p.signature);
  assert.deepEqual(a, b);
  const c = processMember({ ...member, name: "B" }, TS).map(p => p.signature);
  assert.notDeepEqual(a, c);
  assert.notDeepEqual(a, processMember(member, "2026-10-07T00:00:00.000Z").map(p => p.signature));
});

test("logging records match, packet, signature and route events", () => {
  clearLog();
  const [p] = processMember(member, TS);
  beastIntegration(p, TS);
  const events = getLog().map(e => e.event);
  for (const e of ["eligibility.matched", "packet.created", "signature.generated", "route.created"]) {
    assert.ok(events.includes(e), e);
  }
});
