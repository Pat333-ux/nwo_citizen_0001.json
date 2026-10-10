import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Ledger } from "../src/ledger/ledger.ts";
import { GENESIS_HASH } from "../src/constants/statuses.ts";
import { buildContext, runRules, type Rule } from "../src/rules/engine.ts";
import { transition } from "../src/flow.ts";
import { merkleRoot } from "../src/crypto/merkle.ts";
import type { FamilyProfile } from "../src/types/FamilyProfile.ts";

const rules: Rule[] = JSON.parse(
  readFileSync(new URL("../src/rules/rules.json", import.meta.url), "utf8"),
);

test("ledger chains from genesis and detects tampering", () => {
  const l = new Ledger();
  const a = l.append("sys", "citizen.created", { id: "1" });
  l.append("sys", "citizen.verified", { id: "1" });
  assert.equal(a.previousHash, GENESIS_HASH);
  assert.deepEqual(l.verify(), { valid: true });
  const copy = l.list().map((r) => ({ ...r }));
  copy[0].actor = "evil";
  assert.deepEqual(l.verify(copy), { valid: false, brokenAt: 0 });
});

test("rules engine returns program and reason only", () => {
  const p = { monthlyIncome: 1000, adults: 1, children: 2, veteranStatus: false,
    disabilityStatus: false, housingStatus: "renting" } as FamilyProfile;
  const d = runRules(rules, buildContext(p, { povertyLevel: 2000 }));
  assert.deepEqual(d, [{ program: "Food Assistance", reason: "Income below threshold" }]);
  assert.deepEqual(runRules(rules, buildContext(p, { povertyLevel: 500 })), []);
});

test("Sprint 1 end-to-end flow produces a verifiable chain", () => {
  const l = new Ledger();
  l.append("identity", "citizen.created", { id: "c1" });
  l.append("identity", "citizen.verified", { id: "c1" });
  let app: FamilyProfile = { familyId: "f1", adults: 1, children: 1, monthlyIncome: 900,
    veteranStatus: false, disabilityStatus: false, housingStatus: "renting", status: "draft" };
  app = transition(l, app, "submitted", "c1");
  const decisions = runRules(rules, buildContext(app, { povertyLevel: 2000 }));
  assert.equal(decisions.length, 1);
  assert.throws(() => transition(l, app, "approved", "auto")); // no automatic approvals
  app = transition(l, app, "in_review", "caseworker1");
  app = transition(l, app, "approved", "caseworker1");
  assert.equal(app.status, "approved");
  assert.equal(l.list().length, 5);
  assert.deepEqual(l.verify(), { valid: true });
  assert.equal(merkleRoot(l.list().map((r) => r.currentHash)).length, 64);
});
