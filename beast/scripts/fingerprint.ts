// Prints a JSON fingerprint of a BEAST database: table row counts, ledger validity and Merkle root. No PII.
import pg from "pg";
import { LedgerService, PostgresLedgerStore } from "../src/ledger/store.ts";
import { merkleRoot } from "../src/crypto/merkle.ts";

const url = process.argv[2];
if (!url) throw new Error("usage: fingerprint.ts <database-url>");
const pool = new pg.Pool({ connectionString: url });
const counts: Record<string, number> = {};
for (const t of ["ledger_records", "identities", "identity_pii", "applications", "users", "programs", "ledger_anchors"]) {
  counts[t] = (await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
}
const ledger = new LedgerService(new PostgresLedgerStore(pool));
const recs = await ledger.list();
console.log(JSON.stringify({ counts, ledgerValid: (await ledger.verify()).valid, root: merkleRoot(recs.map((r) => r.currentHash)) }));
await pool.end();
