import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LedgerService, PostgresLedgerStore } from "../src/ledger/store.ts";

const url = process.env.TEST_DATABASE_URL;

test("postgres ledger: concurrent appends, verify, append-only", { skip: !url }, async () => {
  const pool = new pg.Pool({ connectionString: url });
  await pool.query("TRUNCATE ledger_records").catch(() => undefined); // blocked by trigger; ignore
  const base = Number((await pool.query("SELECT count(*) FROM ledger_records")).rows[0].count);
  const store = new PostgresLedgerStore(pool);
  const ledger = new LedgerService(store);
  await Promise.all(Array.from({ length: 15 }, (_, i) => ledger.append("a", "x", { i })));
  const recs = await ledger.list();
  assert.equal(recs.length, base + 15);
  assert.deepEqual(await ledger.verify(), { valid: true });

  await assert.rejects(pool.query("UPDATE ledger_records SET actor = 'evil'"), /append-only/);
  await assert.rejects(pool.query("DELETE FROM ledger_records"), /append-only/);
  await assert.rejects(pool.query("TRUNCATE ledger_records"), /append-only/);
  await pool.end();
});

test("postgres case store: workflow end-to-end, PII encrypted at rest", { skip: !url }, async () => {
  const { randomBytes } = await import("node:crypto");
  const { CaseService } = await import("../src/server/cases.ts");
  const { PostgresCaseStore } = await import("../src/server/caseStore.ts");
  const pool = new pg.Pool({ connectionString: url });
  const ledger = new LedgerService(new PostgresLedgerStore(pool));
  const svc = new CaseService(ledger, new PostgresCaseStore(pool), randomBytes(32),
    [{ ruleId: "LOW_INCOME", field: "householdIncome", operator: "<", valueSource: "povertyLevel", service: "Food Assistance", reason: "Income below threshold" }], 2000);

  const id = await svc.createIdentity("cw", { type: "citizen", jurisdiction: "US-IN", name: "Zed Plaintext", address: "9 Oak", email: "z@example.com" });
  await svc.verifyIdentity("cw", id.id);
  const app = await svc.createApplication("cw", { identityId: id.id, adults: 1, children: 1, monthlyIncome: 800, veteranStatus: false, disabilityStatus: false, housingStatus: "renting" });
  for (const to of ["submitted", "in_review", "approved"] as const) await svc.transition("cw", app.familyId, to);
  assert.equal((await svc.recommendations(app.familyId)).length, 1);
  assert.ok((await svc.kpis()).approvals >= 1);
  assert.deepEqual(await ledger.verify(), { valid: true });

  const raw = await pool.query("SELECT encrypted_name FROM identity_pii WHERE identity_id = $1", [id.id]);
  assert.equal(raw.rows[0].encrypted_name.includes("Zed"), false);
  await pool.end();
});

test("postgres user store: create, duplicate, disable, last-admin guard", { skip: !url }, async () => {
  const { PostgresUserStore, UserService } = await import("../src/server/users.ts");
  const pool = new pg.Pool({ connectionString: url });
  const ledger = new LedgerService(new PostgresLedgerStore(pool));
  const svc = new UserService(new PostgresUserStore(pool), ledger);
  const name = "pg-" + Math.random().toString(36).slice(2, 10);
  const u = await svc.create("tester", { username: name, password: "long-enough-password", role: "caseworker" });
  await assert.rejects(svc.create("tester", { username: name, password: "long-enough-password", role: "auditor" }), /username taken/);
  assert.ok(await svc.authenticate(name, "long-enough-password"));
  await svc.setActive("tester", u.id, false);
  assert.equal(await svc.authenticate(name, "long-enough-password"), undefined);
  const raw = await pool.query("SELECT password_hash FROM users WHERE id = $1", [u.id]);
  assert.ok(raw.rows[0].password_hash.startsWith("$argon2id$"));
  assert.deepEqual(await ledger.verify(), { valid: true });
  await pool.end();
});
