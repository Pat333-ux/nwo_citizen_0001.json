import { ALLOWED_TRANSITIONS } from "./constants/statuses.ts";
import type { Ledger } from "./ledger/ledger.ts";
import type { ApplicationStatus, FamilyProfile } from "./types/FamilyProfile.ts";

export function transition(
  ledger: Ledger,
  app: FamilyProfile,
  to: ApplicationStatus,
  actor: string,
): FamilyProfile {
  if (!ALLOWED_TRANSITIONS[app.status]?.includes(to)) {
    throw new Error(`Invalid transition ${app.status} -> ${to}`);
  }
  ledger.append(actor, `application.${to}`, { familyId: app.familyId, from: app.status, to });
  return { ...app, status: to };
}
