export type AgencyOutcome = "approved-by-agency" | "denied" | "pending-agency";

const MAP: Record<string, AgencyOutcome> = {
  "approved": "approved-by-agency",
  "denied": "denied",
  "in-review": "pending-agency"
};

export function normalizeOutcome(raw?: string | null): AgencyOutcome {
  if (!raw) return "pending-agency";
  return Object.hasOwn(MAP, raw) ? MAP[raw] : "pending-agency";
}
