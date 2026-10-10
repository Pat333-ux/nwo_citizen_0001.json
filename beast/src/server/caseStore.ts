import pg from "pg";
import type { BeastIdentity, IdentityPII } from "../types/BeastIdentity.ts";
import type { ApplicationStatus, FamilyProfile } from "../types/FamilyProfile.ts";

export type StoredApp = FamilyProfile & { identityId: string };

export interface CaseStore {
  insertIdentity(i: BeastIdentity, pii: IdentityPII, tx?: unknown): Promise<void>;
  getIdentity(id: string): Promise<BeastIdentity | undefined>;
  updateIdentity(i: BeastIdentity, tx?: unknown): Promise<void>;
  insertApp(a: StoredApp, tx?: unknown): Promise<void>;
  getApp(familyId: string): Promise<StoredApp | undefined>;
  setAppStatus(familyId: string, status: ApplicationStatus, tx?: unknown): Promise<void>;
  /** Aggregates only. */
  counts(): Promise<{ byStatus: Record<string, number>; activeIdentities: number }>;
}

export class MemoryCaseStore implements CaseStore {
  #ids = new Map<string, BeastIdentity>();
  #apps = new Map<string, StoredApp>();

  async insertIdentity(i: BeastIdentity, _pii?: IdentityPII, _tx?: unknown): Promise<void> {
    this.#ids.set(i.id, { ...i });
  }
  async getIdentity(id: string) {
    const i = this.#ids.get(id);
    return i && { ...i };
  }
  async updateIdentity(i: BeastIdentity, tx?: unknown): Promise<void> {
    this.#ids.set(i.id, { ...i });
  }
  async insertApp(a: StoredApp, tx?: unknown): Promise<void> {
    this.#apps.set(a.familyId, { ...a });
  }
  async getApp(familyId: string) {
    const a = this.#apps.get(familyId);
    return a && { ...a };
  }
  async setAppStatus(familyId: string, status: ApplicationStatus, tx?: unknown): Promise<void> {
    const a = this.#apps.get(familyId);
    if (a) a.status = status;
  }
  async counts() {
    const byStatus: Record<string, number> = {};
    for (const a of this.#apps.values()) byStatus[a.status] = (byStatus[a.status] ?? 0) + 1;
    return { byStatus, activeIdentities: [...this.#ids.values()].filter((i) => i.status === "active").length };
  }
}

export class PostgresCaseStore implements CaseStore {
  #pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  #q(tx?: unknown): pg.Pool | pg.PoolClient {
    return (tx as pg.PoolClient | undefined) ?? this.#pool;
  }

  async insertIdentity(i: BeastIdentity, pii: IdentityPII, tx?: unknown): Promise<void> {
    const c = (tx as pg.PoolClient | undefined) ?? (await this.#pool.connect());
    const own = !tx;
    try {
      if (own) await c.query("BEGIN");
      await c.query(
        `INSERT INTO identities (id,did,type,jurisdiction,verification_level,status,reputation,wallet,hash,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [i.id, i.did, i.type, i.jurisdiction, i.verificationLevel, i.status, i.reputation, i.wallet ?? null, i.hash, i.createdAt, i.updatedAt],
      );
      await c.query(
        "INSERT INTO identity_pii (identity_id, encrypted_name, encrypted_address, encrypted_email) VALUES ($1,$2,$3,$4)",
        [pii.identityId, pii.encryptedName, pii.encryptedAddress, pii.encryptedEmail],
      );
      if (own) await c.query("COMMIT");
    } catch (e) {
      if (own) await c.query("ROLLBACK");
      throw e;
    } finally {
      if (own) c.release();
    }
  }

  async getIdentity(id: string) {
    const r = await this.#pool.query("SELECT * FROM identities WHERE id = $1", [id]);
    const w = r.rows[0];
    if (!w) return undefined;
    const i: BeastIdentity = {
      id: w.id, did: w.did, type: w.type, jurisdiction: w.jurisdiction,
      verificationLevel: w.verification_level, status: w.status, reputation: w.reputation,
      hash: w.hash, createdAt: w.created_at, updatedAt: w.updated_at,
    };
    if (w.wallet) i.wallet = w.wallet;
    return i;
  }

  async updateIdentity(i: BeastIdentity, tx?: unknown): Promise<void> {
    await this.#q(tx).query(
      "UPDATE identities SET verification_level=$2, status=$3, reputation=$4, updated_at=$5 WHERE id=$1",
      [i.id, i.verificationLevel, i.status, i.reputation, i.updatedAt],
    );
  }

  async insertApp(a: StoredApp, tx?: unknown): Promise<void> {
    await this.#q(tx).query(
      `INSERT INTO applications (family_id,identity_id,adults,children,monthly_income,veteran_status,disability_status,housing_status,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [a.familyId, a.identityId, a.adults, a.children, a.monthlyIncome, a.veteranStatus, a.disabilityStatus, a.housingStatus, a.status],
    );
  }

  async getApp(familyId: string) {
    const r = await this.#pool.query("SELECT * FROM applications WHERE family_id = $1", [familyId]);
    const w = r.rows[0];
    if (!w) return undefined;
    return {
      familyId: w.family_id, identityId: w.identity_id, adults: w.adults, children: w.children,
      monthlyIncome: Number(w.monthly_income), veteranStatus: w.veteran_status,
      disabilityStatus: w.disability_status, housingStatus: w.housing_status, status: w.status,
    } as StoredApp;
  }

  async setAppStatus(familyId: string, status: ApplicationStatus, tx?: unknown): Promise<void> {
    await this.#q(tx).query("UPDATE applications SET status = $2 WHERE family_id = $1", [familyId, status]);
  }

  async counts() {
    const s = await this.#pool.query("SELECT status, count(*)::int AS n FROM applications GROUP BY status");
    const a = await this.#pool.query("SELECT count(*)::int AS n FROM identities WHERE status = 'active'");
    return {
      byStatus: Object.fromEntries(s.rows.map((r) => [r.status, r.n])) as Record<string, number>,
      activeIdentities: a.rows[0].n as number,
    };
  }
}
