import { randomUUID } from "node:crypto";
import { GENESIS_HASH } from "../constants/statuses.ts";
import { computeRecordHash, sha256 } from "../crypto/hash.ts";
import type { LedgerRecord } from "../types/LedgerRecord.ts";

export interface VerifyResult {
  valid: boolean;
  brokenAt?: number;
}

/**
 * Append-only ledger. Exposes append and read only: no update, no delete.
 * Only this service writes records; other services call append().
 * Payloads are hashed; callers must never pass PII.
 */
export class Ledger {
  #records: LedgerRecord[] = [];

  append(actor: string, action: string, payload: unknown, now = Date.now()): LedgerRecord {
    const last = this.#records[this.#records.length - 1];
    const base = {
      previousHash: last ? last.currentHash : GENESIS_HASH,
      sequence: this.#records.length,
      timestamp: now,
      action,
      actor,
      payloadHash: sha256(JSON.stringify(payload ?? null)),
    };
    const record: LedgerRecord = {
      id: randomUUID(),
      ...base,
      currentHash: computeRecordHash(base),
    };
    this.#records.push(Object.freeze(record));
    return record;
  }

  list(): readonly LedgerRecord[] {
    return this.#records.map((r) => ({ ...r }));
  }

  verify(records: readonly LedgerRecord[] = this.#records): VerifyResult {
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
