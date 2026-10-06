import { evaluateEligibility, generateApplicationPacket } from "../engine.ts";
import type { Member, SignedPacket } from "../types.ts";
import { log } from "./log.ts";
import { signPacket } from "./signature.ts";

export function processMember(memberProfile: Member, timestamp: string = new Date().toISOString()): SignedPacket[] {
  const eligible = evaluateEligibility(memberProfile);
  log("eligibility.matched", { memberId: memberProfile.id, programIds: eligible.map(p => p.id) });
  return eligible.map(p => {
    const packet = generateApplicationPacket(p, memberProfile);
    log("packet.created", { programId: packet.programId, memberId: packet.memberId });
    return signPacket(packet, timestamp);
  });
}
