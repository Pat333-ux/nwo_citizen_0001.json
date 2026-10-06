import type { Submission } from "./submission.ts";

export function computeMetrics(queue: readonly Submission[]) {
  const byStatus: Record<string, number> = {};
  const byAgency: Record<string, number> = {};
  for (const q of queue) {
    byStatus[q.status] = (byStatus[q.status] ?? 0) + 1;
    byAgency[q.agencyId] = (byAgency[q.agencyId] ?? 0) + 1;
  }
  return { totals: queue.length, byStatus, byAgency };
}
