import { randomUUID } from "node:crypto";
import { ALLOWED_TRANSITIONS } from "../constants/statuses.ts";
import { sha256 } from "../crypto/hash.ts";
import { encryptPII } from "../crypto/pii.ts";
import { merkleRoot } from "../crypto/merkle.ts";
import type { LedgerService } from "../ledger/store.ts";
import { buildContext, runRules, type Decision, type Rule } from "../rules/engine.ts";
import type { BeastIdentity, IdentityPII, IdentityType } from "../types/BeastIdentity.ts";
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
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

/**
 * Identity and Family First domain. PII is kept encrypted in a separate map
 * and never reaches the ledger, which only receives ids and status changes.
 * In-memory for now; persistence for these tables is not implemented.
 */
export class CaseService {
  #ledger: LedgerService;
  #key: Buffer;
  #rules: Rule[];
  #povertyLevelMonthly: number;
  #identities = new Map<string, BeastIdentity>();
  #pii = new Map<string, IdentityPII>();
  #apps = new Map<string, FamilyProfile & { identityId: string }>();

  constructor(ledger: LedgerService, piiKey: Buffer, rules: Rule[], povertyLevelMonthly: number) {
    this.#ledger = ledger;
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
    this.#identities.set(id, identity);
    this.#pii.set(id, {
      identityId: id,
      encryptedName: encryptPII(n.name, this.#key),
      encryptedAddress: encryptPII(n.address, this.#key),
      encryptedEmail: encryptPII(n.email, this.#key),
    });
    await this.#ledger.append(actor, "citizen.created", { identityId: id });
    return identity;
  }

  async verifyIdentity(actor: string, id: string): Promise<BeastIdentity> {
    const identity = this.#identities.get(id);
    if (!identity) throw new NotFoundError("identity");
    if (identity.status !== "active") throw new ConflictError("identity not active");
    identity.verificationLevel += 1;
    identity.updatedAt = new Date();
    await this.#ledger.append(actor, "citizen.verified", { identityId: id, level: identity.verificationLevel });
    return { ...identity };
  }

  async createApplication(actor: string, n: NewApplication): Promise<FamilyProfile> {
    const identity = this.#identities.get(n.identityId);
    if (!identity) throw new NotFoundError("identity");
    if (identity.verificationLevel < 1) throw new ConflictError("identity not verified");
    const app = {
      familyId: randomUUID(),
      identityId: n.identityId,
      adults: n.adults,
      children: n.children,
      monthlyIncome: n.monthlyIncome,
      veteranStatus: n.veteranStatus,
      disabilityStatus: n.disabilityStatus,
      housingStatus: n.housingStatus,
      status: "draft" as ApplicationStatus,
    };
    this.#apps.set(app.familyId, app);
    await this.#ledger.append(actor, "application.created", { familyId: app.familyId });
    return publicView(app);
  }

  async transition(actor: string, familyId: string, to: ApplicationStatus): Promise<FamilyProfile> {
    const app = this.#apps.get(familyId);
    if (!app) throw new NotFoundError("application");
    if (!ALLOWED_TRANSITIONS[app.status]?.includes(to)) {
      throw new ConflictError(`invalid transition ${app.status} -> ${to}`);
    }
    const from = app.status;
    await this.#ledger.append(actor, `application.${to}`, { familyId, from, to });
    app.status = to;
    return publicView(app);
  }

  /** Recommendations only. A caseworker makes the decision. */
  recommendations(familyId: string): Decision[] {
    const app = this.#apps.get(familyId);
    if (!app) throw new NotFoundError("application");
    return runRules(this.#rules, buildContext(app, { povertyLevel: this.#povertyLevelMonthly }));
  }

  /** Aggregates only; no per-family or per-person data. */
  kpis(): Kpis {
    const apps = [...this.#apps.values()];
    const count = (s: ApplicationStatus) => apps.filter((a) => a.status === s).length;
    return {
      familiesServed: count("approved"),
      applicationsPending: count("submitted") + count("in_review"),
      activeCitizens: [...this.#identities.values()].filter((i) => i.status === "active").length,
      approvals: count("approved"),
      denials: count("denied"),
      appeals: count("appealed"),
    };
  }

  /** Merkle root of the ledger hashes: the value (no PII) intended for external anchoring. */
  async ledgerRoot(): Promise<{ records: number; root: string }> {
    const recs = await this.#ledger.list();
    return { records: recs.length, root: merkleRoot(recs.map((r) => r.currentHash)) };
  }
}

function publicView(a: FamilyProfile & { identityId: string }): FamilyProfile {
  const { identityId: _omit, ...rest } = a;
  return { ...rest };
}
