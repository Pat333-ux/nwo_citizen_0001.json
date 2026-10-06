import test from "node:test";
import assert from "node:assert/strict";
import { processMember } from "../src/pipeline/index.ts";
import { beastIntegration } from "../src/pipeline/beast-hook.ts";

test("pipeline returns packets for eligible programs only", () => {
  const packets = processMember({ id: "0001", name: "A", tax: { owesIRS: true, ssnLast4: "1234", balanceOwed: 100 } });
  assert.deepEqual(packets.map(p => p.programId).sort(), ["TAX-IA", "TAX-OIC"]);
  assert.equal(packets[0].autoFill.fullName, "A");
});

test("beast hook wraps packet", () => {
  const [p] = processMember({ id: "0001", tax: { owesIRS: true } });
  assert.equal(beastIntegration(p).status, "ready-for-routing");
  assert.equal(beastIntegration(p).citizenId, "0001");
});

test("ineligible member yields no packets", () => {
  assert.equal(processMember({ id: "x" }).length, 0);
});
