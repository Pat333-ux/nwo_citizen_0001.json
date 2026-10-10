import { createHash } from "node:crypto";
import type { LedgerRecord } from "../types/LedgerRecord.ts";

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function computeRecordHash(
  r: Pick<
    LedgerRecord,
    "previousHash" | "sequence" | "timestamp" | "action" | "actor" | "payloadHash"
  >,
): string {
  return sha256(
    r.previousHash + r.sequence + r.timestamp + r.action + r.actor + r.payloadHash,
  );
}
