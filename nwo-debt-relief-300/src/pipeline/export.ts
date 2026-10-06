import type { Submission } from "./submission.ts";

export function exportQueueForBeast(queue: readonly Submission[]) {
  return queue.map(entry => ({
    envelopeId: entry.envelopeId,
    programId: entry.packet.programId,
    memberId: entry.packet.memberId,
    status: entry.status,
    agency: entry.agencyId,
    signature: entry.packet.signature,
    timestamp: entry.packet.timestamp
  }));
}
