import { randomUUID } from "node:crypto";
import pg from "pg";
import { GENESIS_HASH } from "../constants/statuses.ts";
import { computeRecordHash, sha256 } from "../crypto/hash.ts";
import type { LedgerRecord } from "../types/LedgerRecord.ts";
import type { VerifyResult } from "./ledger.ts";

/**
 * State change committed atomically with the ledger record. `tx` is an opaque
 * handle that case stores use to join the same database transaction.
 * If it throws, no ledger record is written.
 */
export type Work = (tx: unknown) => Promise<void>;

/** Storage exposes append and read only. There is no update or delete. */
export interface LedgerStore {
  /** Atomically builds and stores the next record given the current tail. */
  appendNext(
    build: (last: LedgerRecord | undefined) => LedgerRecord,
    work?: Work,
  ): Promise<LedgerRecord>;
  all(): Promise<LedgerRecord[]>;
}

export class MemoryLedgerStore implements LedgerStore {
  #records: LedgerRecord[] = [];
  #queue: Promise<unknown> = Promise.resolve();

  appendNext(build: (last: LedgerRecord | undefined) => LedgerRecord, work?: Work): Promise<LedgerRecord> {
    const run = this.#queue.then(async () => {
      const r = build(this.#records[this.#records.length - 1]);
      if (work) await work(undefined);
      this.#records.push(Object.freeze(r));
      return r;
    });
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async all(): Promise<LedgerRecord[]> {
    return this.#records.map((r) => ({ ...r }));
  }
}

const ADVISORY_LOCK_KEY = 7_420_26;

export class PostgresLedgerStore implements LedgerStore {
  #pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  static fromEnv(): PostgresLedgerStore {
    return new PostgresLedgerStore(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
  }

  async appendNext(build: (last: LedgerRecord | undefined) => LedgerRecord, work?: Work): Promise<LedgerRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);
      const res = await client.query(
        "SELECT * FROM ledger_records ORDER BY sequence DESC LIMIT 1",
      );
      const r = build(res.rows[0] ? rowToRecord(res.rows[0]) : undefined);
      if (work) await work(client);
      await client.query(
        `INSERT INTO ledger_records
         (id, sequence, previous_hash, payload_hash, current_hash, actor, action, timestamp_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [r.id, r.sequence, r.previousHash, r.payloadHash, r.currentHash, r.actor, r.action, r.timestamp],
      );
      await client.query("COMMIT");
      return r;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async all(): Promise<LedgerRecord[]> {
    const res = await this.#pool.query("SELECT * FROM ledger_records ORDER BY sequence ASC");
    return res.rows.map(rowToRecord);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

function rowToRecord(row: Record<string, unknown>): LedgerRecord {
  return {
    id: row.id as string,
    sequence: Number(row.sequence),
    previousHash: row.previous_hash as string,
    payloadHash: row.payload_hash as string,
    currentHash: row.current_hash as string,
    actor: row.actor as string,
    action: row.action as string,
    timestamp: Number(row.timestamp_ms),
  };
}

/** The only writer of ledger records. Other services submit events through this. */
export class LedgerService {
  #store: LedgerStore;
  constructor(store: LedgerStore) {
    this.#store = store;
  }

  append(actor: string, action: string, payload: unknown, now = Date.now()): Promise<LedgerRecord> {
    return this.appendWith(actor, action, payload, undefined, now);
  }

  /** Runs `work` and appends the ledger record in one transaction: both commit or neither does. */
  appendWith(actor: string, action: string, payload: unknown, work?: Work, now = Date.now()): Promise<LedgerRecord> {
    return this.#store.appendNext((last) => {
      const base = {
        previousHash: last ? last.currentHash : GENESIS_HASH,
        sequence: last ? last.sequence + 1 : 0,
        timestamp: now,
        action,
        actor,
        payloadHash: sha256(JSON.stringify(payload ?? null)),
      };
      return { id: randomUUID(), ...base, currentHash: computeRecordHash(base) };
    }, work);
  }

  list(): Promise<LedgerRecord[]> {
    return this.#store.all();
  }

  async verify(): Promise<VerifyResult> {
    const records = await this.#store.all();
    let prev = GENESIS_HASH;
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.sequence !== i || r.previousHash !== prev || r.currentHash !== computeRecordHash(r)) {
        return { valid: false, brokenAt: i };
      }
      prev = r.currentHash;
    }
    return { valid: true };
  }
}
