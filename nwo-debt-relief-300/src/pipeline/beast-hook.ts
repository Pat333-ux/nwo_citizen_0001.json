import type { SignedPacket } from "../types.ts";
import { log } from "./log.ts";

export function beastIntegration(packet: SignedPacket, timestamp: string = new Date().toISOString()) {
  const envelope = {
    envelopeId: `${packet.programId}-${packet.memberId}`,
    signature: packet.signature,
    route: {
      target: "beast-system-3.0" as const,
      priority: "standard" as const,
      timestamp
    },
    payload: packet,
    status: "ready-for-routing" as const
  };
  log("route.created", { envelopeId: envelope.envelopeId, target: envelope.route.target });
  return envelope;
}
