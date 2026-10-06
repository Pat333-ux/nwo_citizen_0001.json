import test from "node:test";
import assert from "node:assert/strict";
import { processMember } from "../src/pipeline/index.ts";

test("pipeline returns packets for eligible programs only", () => {
  const packets = processMember({ id: "0001", name: "A", tax: { owesIRS: true, ssnLast4: "1234", balanceOwed: 100 } });
  assert.deepEqual(packets.map(p => p.programId).sort(), ["tax-ia", "tax-oic"]);
  assert.equal(packets[0].autoFill.fullName, "A");
});

test("ineligible member yields no packets", () => {
  assert.equal(processMember({ id: "x" }).length, 0);
});
