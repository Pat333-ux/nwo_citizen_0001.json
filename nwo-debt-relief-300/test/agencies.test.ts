import test from "node:test";
import assert from "node:assert/strict";
import { programs } from "../src/engine.ts";
import { agencyForProgram } from "../src/pipeline/agencies.ts";
import { processMember } from "../src/pipeline/index.ts";
import { queueForAgency, approve, submit, recordOutcome, clearSubmissions, listByAgency } from "../src/pipeline/submission.ts";

test("every program maps to an agency channel", () => {
  for (const p of programs) assert.ok(agencyForProgram(p).agencyId, p.id);
});

test("submission requires approval, then tracks outcome", async () => {
  clearSubmissions();
  const [p] = processMember({ id: "1", tax: { owesIRS: true } }, "2026-10-06T00:00:00.000Z");
  const s = queueForAgency(p);
  assert.equal(s.agencyId, "irs");
  let sent = 0;
  await assert.rejects(submit(s.envelopeId, async () => { sent++; }));
  assert.equal(sent, 0);
  approve(s.envelopeId);
  await submit(s.envelopeId, async () => { sent++; });
  assert.equal(sent, 1);
  assert.equal(recordOutcome(s.envelopeId, "denied").status, "denied");
  assert.equal(listByAgency("irs").length, 1);
});
