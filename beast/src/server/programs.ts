import pg from "pg";
import { ConflictError, NotFoundError } from "./cases.ts";
import type { LedgerService } from "../ledger/store.ts";

export interface Program {
  id: string;
  name: string;
  description: string;
  ruleSet: string | null;
  active: boolean;
}

export const DEFAULT_PROGRAMS: readonly Program[] = [
  { id: "family-first", name: "Family First", description: "Family support program", ruleSet: "family-first", active: true },
  { id: "housing", name: "Housing", description: "Housing assistance", ruleSet: null, active: true },
  { id: "employment", name: "Employment", description: "Employment services", ruleSet: null, active: true },
  { id: "veteran-support", name: "Veteran Support", description: "Veteran support services", ruleSet: null, active: true },
  { id: "food-security", name: "Food Security", description: "Food assistance", ruleSet: null, active: true },
  { id: "education", name: "Education", description: "Education support", ruleSet: null, active: true },
];

export const DEFAULT_PROGRAM_ID = "family-first";

export interface ProgramStore {
  list(): Promise<Program[]>;
  get(id: string): Promise<Program | undefined>;
  insert(p: Program): Promise<void>; // throws ConflictError on duplicate id
  update(p: Program): Promise<void>;
}

export class MemoryProgramStore implements ProgramStore {
  #p = new Map<string, Program>(DEFAULT_PROGRAMS.map((p) => [p.id, { ...p }]));
  async list() {
    return [...this.#p.values()].map((p) => ({ ...p }));
  }
  async get(id: string) {
    const p = this.#p.get(id);
    return p && { ...p };
  }
  async insert(p: Program) {
    if (this.#p.has(p.id)) throw new ConflictError("program id taken");
    this.#p.set(p.id, { ...p });
  }
  async update(p: Program) {
    this.#p.set(p.id, { ...p });
  }
}

const row = (w: Record<string, unknown>): Program => ({
  id: w.id as string, name: w.name as string, description: w.description as string,
  ruleSet: (w.rule_set as string | null) ?? null, active: w.active as boolean,
});

export class PostgresProgramStore implements ProgramStore {
  #pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }
  async list() {
    return (await this.#pool.query("SELECT * FROM programs ORDER BY created_at ASC, id ASC")).rows.map(row);
  }
  async get(id: string) {
    const r = await this.#pool.query("SELECT * FROM programs WHERE id = $1", [id]);
    return r.rows[0] ? row(r.rows[0]) : undefined;
  }
  async insert(p: Program) {
    try {
      await this.#pool.query("INSERT INTO programs (id, name, description, rule_set, active) VALUES ($1,$2,$3,$4,$5)", [p.id, p.name, p.description, p.ruleSet, p.active]);
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ConflictError("program id taken");
      throw e;
    }
  }
  async update(p: Program) {
    await this.#pool.query("UPDATE programs SET name=$2, description=$3, rule_set=$4, active=$5 WHERE id=$1", [p.id, p.name, p.description, p.ruleSet, p.active]);
  }
}

export class ProgramService {
  #store: ProgramStore;
  #ledger: LedgerService;
  #ruleSets: ReadonlySet<string>;

  /** `ruleSets` lists the rule-set keys this build can run; a program may only reference one of those. */
  constructor(store: ProgramStore, ledger: LedgerService, ruleSets: Iterable<string> = [DEFAULT_PROGRAM_ID]) {
    this.#store = store;
    this.#ledger = ledger;
    this.#ruleSets = new Set(ruleSets);
  }

  list(): Promise<Program[]> {
    return this.#store.list();
  }

  async requireActive(id: string): Promise<Program> {
    const p = await this.#store.get(id);
    if (!p) throw new NotFoundError("program");
    if (!p.active) throw new ConflictError("program is not accepting applications");
    return p;
  }

  async get(id: string): Promise<Program | undefined> {
    return this.#store.get(id);
  }

  async create(actor: string, n: { id: string; name: string; description?: string; ruleSet?: string | null }): Promise<Program> {
    const ruleSet = n.ruleSet ?? null;
    if (ruleSet !== null && !this.#ruleSets.has(ruleSet)) throw new ConflictError("unknown rule set");
    const p: Program = { id: n.id, name: n.name, description: n.description ?? "", ruleSet, active: true };
    await this.#store.insert(p);
    await this.#ledger.append(actor, "program.created", { programId: p.id });
    return p;
  }

  async setActive(actor: string, id: string, active: boolean): Promise<Program> {
    const p = await this.#store.get(id);
    if (!p) throw new NotFoundError("program");
    p.active = active;
    await this.#ledger.append(actor, active ? "program.enabled" : "program.disabled", { programId: id });
    await this.#store.update(p);
    return p;
  }
}
