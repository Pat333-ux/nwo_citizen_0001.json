import type { Packet } from "../types.ts";

export function beastIntegration(packet: Packet) {
  return {
    anchorId: packet.programId,
    citizenId: packet.memberId,
    payload: packet.autoFill,
    status: "ready-for-routing" as const
  };
}
