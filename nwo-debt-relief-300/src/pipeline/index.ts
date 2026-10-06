import { runPipeline } from "../engine.ts";
import type { Member, Packet } from "../types.ts";

export function processMember(memberProfile: Member): Packet[] {
  return runPipeline(memberProfile);
}
