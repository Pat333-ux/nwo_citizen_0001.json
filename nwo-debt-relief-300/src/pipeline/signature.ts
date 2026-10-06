import { createHash } from "node:crypto";
import type { Packet, SignedPacket } from "../types.ts";
import { log } from "./log.ts";

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function computeSignature(
  p: Pick<Packet, "programId" | "memberId" | "autoFill">,
  timestamp: string
): string {
  const input = canonical({ programId: p.programId, memberId: p.memberId, autoFill: p.autoFill, timestamp });
  return createHash("sha256").update(input).digest("hex");
}

export function signPacket(packet: Packet, timestamp: string = new Date().toISOString()): SignedPacket {
  const signature = computeSignature(packet, timestamp);
  log("signature.generated", { programId: packet.programId, memberId: packet.memberId, signature });
  return { ...packet, timestamp, signature };
}
