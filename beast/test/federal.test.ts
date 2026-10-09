import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { can, authorize } from "../src/auth/rbac.ts";
import { auditEvent } from "../src/audit/audit.ts";
import { encryptPII, decryptPII } from "../src/crypto/pii.ts";
import { Ledger } from "../src/ledger/ledger.ts";
import { startChainMonitor } from "../src/ledger/monitor.ts";

test("rbac", () => {
  assert.ok(can("auditor", "ledger:read"));
  assert.ok(!can("caseworker", "ledger:read"));
  assert.throws(() => authorize("admin", "case:review"));
});

test("audit rejects PII-looking fields and emits JSON", () => {
  const lines: string[] = [];
  auditEvent({ actor: "cw1", action: "case.review", outcome: "success" }, (l) => lines.push(l));
  assert.equal(JSON.parse(lines[0]).actor, "cw1");
  assert.throws(() => auditEvent({ actor: "x", action: "read email", outcome: "failure" }, () => {}));
});

test("PII encryption roundtrip and tamper detection", () => {
  const key = randomBytes(32);
  const t = encryptPII("Jane Doe", key);
  assert.equal(decryptPII(t, key), "Jane Doe");
  assert.throws(() => decryptPII(t, randomBytes(32)));
});

test("chain monitor reports no failure on valid ledger", async () => {
  const l = new Ledger();
  l.append("a", "x", {});
  let failed = false;
  const stop = startChainMonitor(l, 5, () => { failed = true; });
  await new Promise((r) => setTimeout(r, 30));
  stop();
  assert.equal(failed, false);
});
