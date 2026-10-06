import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOutcome } from "../src/pipeline/outcomes.ts";
import { exportQueueForBeast } from "../src/pipeline/export.ts";
import { computeMetrics } from "../src/pipeline/metrics.ts";
import { processMember } from "../src/pipeline/index.ts";
import { queueForAgency, clearSubmissions, listAll } from "../src/pipeline/submission.ts";

test("normalizeOutcome collapses codes", () => {
  assert.equal(normalizeOutcome("approved"), "approved-by-agency");
  assert.equal(normalizeOutcome("denied"), "denied");
  assert.equal(normalizeOutcome("in-review"), "pending-agency");
  assert.equal(normalizeOutcome(undefined), "pending-agency");
  assert.equal(normalizeOutcome("weird"), "pending-agency");
  assert.equal(normalizeOutcome("constructor"), "pending-agency");
});

test("export and metrics", () => {
  clearSubmissions();
  for (const p of processMember({ id: "1", tax: { owesIRS: true } }, "2026-10-06T00:00:00.000Z")) queueForAgency(p);
  const q = listAll();
  const out = exportQueueForBeast(q);
  assert.equal(out.length, 2);
  assert.deepEqual(Object.keys(out[0]).sort(), ["agency", "envelopeId", "memberId", "programId", "signature", "status", "timestamp"]);
  assert.deepEqual(computeMetrics(q), { totals: 2, byStatus: { "pending-approval": 2 }, byAgency: { irs: 2 } });
});
