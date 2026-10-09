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
