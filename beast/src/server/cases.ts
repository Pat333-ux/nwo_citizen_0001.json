import { randomUUID } from "node:crypto";
import { ALLOWED_TRANSITIONS } from "../constants/statuses.ts";
import { sha256 } from "../crypto/hash.ts";
import { encryptPII } from "../crypto/pii.ts";
import { merkleRoot } from "../crypto/merkle.ts";
import type { LedgerService } from "../ledger/store.ts";
import { buildContext, runRules, type Decision, type Rule } from "../rules/engine.ts";
import { DEFAULT_PROGRAM_ID, type ProgramService } from "./programs.ts";
import type { CaseStore, StoredApp } from "./caseStore.ts";
import type { BeastIdentity, IdentityType } from "../types/BeastIdentity.ts";
import type { ApplicationStatus, FamilyProfile } from "../types/FamilyProfile.ts";

export interface NewIdentity {
  type: IdentityType;
  jurisdiction: string;
  name: string;
  address: string;
  email: string;
}

export interface NewApplication {
  identityId: string;
  programId?: string;
  adults: number;
  children: number;
  monthlyIncome: number;
  veteranStatus: boolean;
  disabilityStatus: boolean;
  housingStatus: string;
}

export interface Kpis {
  familiesServed: number;
  applicationsPending: number;
  activeCitizens: number;
  approvals: number;
  denials: number;
  appeals: number;
  byProgram: Record<string, { applications: number; approvals: number; denials: number; appeals: number; pending: number }>;
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/**
 * Identity and Family First domain. PII is kept encrypted in a separate table
 * and never reaches the ledger, which only receives ids and status changes.
 */
export class CaseService {
  #ledger: LedgerService;
  #store: CaseStore;
  #key: Buffer;
  #rules: Rule[];
  #povertyLevelMonthly: number;
  #programs?: ProgramService;

  constructor(ledger: LedgerService, store: CaseStore, piiKey: Buffer, rules: Rule[], povertyLevelMonthly: number, programs?: ProgramService) {
    this.#programs = programs;
    this.#ledger = ledger;
    this.#store = store;
    this.#key = piiKey;
    this.#rules = rules;
    this.#povertyLevelMonthly = povertyLevelMonthly;
  }

  async createIdentity(actor: string, n: NewIdentity): Promise<BeastIdentity> {
    const id = randomUUID();
    const now = new Date();
    const identity: BeastIdentity = {
      id,
      did: `did:beast:${id}`,
      type: n.type,
      jurisdiction: n.jurisdiction,
      verificationLevel: 0,
      status: "active",
      reputation: 0,
      hash: sha256(`${id}|${n.type}|${n.jurisdiction}`),
      createdAt: now,
      updatedAt: now,
    };
    await this.#store.insertIdentity(identity, {
      identityId: id,
      encryptedName: encryptPII(n.name, this.#key),
      encryptedAddress: encryptPII(n.address, this.#key),
      encryptedEmail: encryptPII(n.email, this.#key),
    });
    await this.#ledger.append(actor, "citizen.created", { identityId: id });
    return identity;
  }

  async verifyIdentity(actor: string, id: string): Promise<BeastIdentity> {
    const identity = await this.#store.getIdentity(id);
    if (!identity) throw new NotFoundError("identity");
    if (identity.status !== "active") throw new ConflictError("identity not active");
    identity.verificationLevel += 1;
    identity.updatedAt = new Date();
    await this.#ledger.append(actor, "citizen.verified", { identityId: id, level: identity.verificationLevel });
    await this.#store.updateIdentity(identity);
    return identity;
  }

  async createApplication(actor: string, n: NewApplication): Promise<FamilyProfile> {
    const identity = await this.#store.getIdentity(n.identityId);
    if (!identity) throw new NotFoundError("identity");
    if (identity.verificationLevel < 1) throw new ConflictError("identity not verified");
    const programId = n.programId ?? DEFAULT_PROGRAM_ID;
    if (this.#programs) await this.#programs.requireActive(programId);
    else if (programId !== DEFAULT_PROGRAM_ID) throw new NotFoundError("program");
    const app: StoredApp = {
      familyId: randomUUID(),
      programId,
      identityId: n.identityId,
      adults: n.adults,
      children: n.children,
      monthlyIncome: n.monthlyIncome,
      veteranStatus: n.veteranStatus,
      disabilityStatus: n.disabilityStatus,
      housingStatus: n.housingStatus,
      status: "draft",
    };
    await this.#store.insertApp(app);
    await this.#ledger.append(actor, "application.created", { familyId: app.familyId });
    return publicView(app);
  }

  async transition(actor: string, familyId: string, to: ApplicationStatus): Promise<FamilyProfile> {
    const app = await this.#store.getApp(familyId);
    if (!app) throw new NotFoundError("application");
    if (!ALLOWED_TRANSITIONS[app.status]?.includes(to)) {
      throw new ConflictError(`invalid transition ${app.status} -> ${to}`);
    }
    const from = app.status;
    await this.#ledger.append(actor, `application.${to}`, { familyId, from, to });
    await this.#store.setAppStatus(familyId, to);
    return publicView({ ...app, status: to });
  }

  /** Recommendations only. A caseworker makes the decision. */
  async recommendations(familyId: string): Promise<Decision[]> {
    const app = await this.#store.getApp(familyId);
    if (!app) throw new NotFoundError("application");
    if (this.#programs) {
      const program = await this.#programs.get(app.programId);
      if (!program?.ruleSet) return []; // no automated rules for this program; the caseworker decides
    }
    return runRules(this.#rules, buildContext(app, { povertyLevel: this.#povertyLevelMonthly }));
  }

  /** Aggregates only; no per-family or per-person data. */
  async kpis(): Promise<Kpis> {
    const { byStatus, activeIdentities, byProgram } = await this.#store.counts();
    const n = (s: string) => byStatus[s] ?? 0;
    return {
      familiesServed: n("approved"),
      applicationsPending: n("submitted") + n("in_review"),
      activeCitizens: activeIdentities,
      approvals: n("approved"),
      denials: n("denied"),
      appeals: n("appealed"),
      byProgram: Object.fromEntries(
        Object.entries(byProgram).map(([id, m]) => [id, {
          applications: Object.values(m).reduce((a, b) => a + b, 0),
          approvals: m.approved ?? 0, denials: m.denied ?? 0, appeals: m.appealed ?? 0,
          pending: (m.submitted ?? 0) + (m.in_review ?? 0),
        }]),
      ),
    };
  }

  /** Merkle root of the ledger hashes: the value (no PII) intended for external anchoring. */
  async ledgerRoot(): Promise<{ records: number; root: string }> {
    const recs = await this.#ledger.list();
    return { records: recs.length, root: merkleRoot(recs.map((r) => r.currentHash)) };
  }
}

function publicView(a: StoredApp): FamilyProfile {
  const { identityId: _omit, ...rest } = a;
  return { ...rest };
}
