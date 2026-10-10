import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import type { Role } from "../auth/rbac.ts";
import type { LedgerService } from "../ledger/store.ts";
import { ConflictError, NotFoundError } from "./cases.ts";

export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, { type: argon2.argon2id });

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: Date;
}

export type PublicUser = Omit<User, "passwordHash">;

export interface UserStore {
  insert(u: User, tx?: unknown): Promise<void>; // throws ConflictError on duplicate username
  findById(id: string): Promise<User | undefined>;
  findByUsername(username: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  update(u: User, tx?: unknown): Promise<void>;
  countActiveAdmins(): Promise<number>;
}

export class MemoryUserStore implements UserStore {
  #users = new Map<string, User>();

  static async from(seed: { username: string; password: string; role: Role }[]): Promise<MemoryUserStore> {
    const s = new MemoryUserStore();
    for (const u of seed) {
      await s.insert({ id: randomUUID(), username: u.username, passwordHash: await hashPassword(u.password), role: u.role, active: true, createdAt: new Date() });
    }
    return s;
  }
  async insert(u: User, _tx?: unknown): Promise<void> {
    if ([...this.#users.values()].some((x) => x.username === u.username)) throw new ConflictError("username taken");
    this.#users.set(u.id, { ...u });
  }
  async findById(id: string) {
    const u = this.#users.get(id);
    return u && { ...u };
  }
  async findByUsername(username: string) {
    const u = [...this.#users.values()].find((x) => x.username === username);
    return u && { ...u };
  }
  async list() {
    return [...this.#users.values()].map((u) => ({ ...u }));
  }
  async update(u: User, _tx?: unknown): Promise<void> {
    this.#users.set(u.id, { ...u });
  }
  async countActiveAdmins() {
    return [...this.#users.values()].filter((u) => u.role === "admin" && u.active).length;
  }
}

function rowToUser(w: Record<string, unknown>): User {
  return {
    id: w.id as string,
    username: w.username as string,
    passwordHash: w.password_hash as string,
    role: w.role as Role,
    active: w.active as boolean,
    createdAt: w.created_at as Date,
  };
}

export class PostgresUserStore implements UserStore {
  #pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }
  #q(tx?: unknown): pg.Pool | pg.PoolClient {
    return (tx as pg.PoolClient | undefined) ?? this.#pool;
  }
  async insert(u: User, tx?: unknown): Promise<void> {
    try {
      await this.#q(tx).query(
        "INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
        [u.id, u.username, u.passwordHash, u.role, u.active, u.createdAt],
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ConflictError("username taken");
      throw e;
    }
  }
  async findById(id: string) {
    const r = await this.#pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return r.rows[0] ? rowToUser(r.rows[0]) : undefined;
  }
  async findByUsername(username: string) {
    const r = await this.#pool.query("SELECT * FROM users WHERE username = $1", [username]);
    return r.rows[0] ? rowToUser(r.rows[0]) : undefined;
  }
  async list() {
    const r = await this.#pool.query("SELECT * FROM users ORDER BY created_at ASC");
    return r.rows.map(rowToUser);
  }
  async update(u: User, tx?: unknown): Promise<void> {
    await this.#q(tx).query("UPDATE users SET password_hash=$2, role=$3, active=$4 WHERE id=$1", [u.id, u.passwordHash, u.role, u.active]);
  }
  async countActiveAdmins() {
    const r = await this.#pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active");
    return r.rows[0].n as number;
  }
}

export const MIN_PASSWORD_LENGTH = 12;

export class UserService {
  #store: UserStore;
  #ledger: LedgerService;
  // Fixed hash so unknown usernames cost the same time as wrong passwords.
  #dummyHash: Promise<string> = hashPassword("not-a-real-password");

  constructor(store: UserStore, ledger: LedgerService) {
    this.#store = store;
    this.#ledger = ledger;
  }

  get store(): UserStore {
    return this.#store;
  }

  async authenticate(username: string, password: string): Promise<User | undefined> {
    const user = await this.#store.findByUsername(username);
    const ok = await argon2.verify(user?.passwordHash ?? (await this.#dummyHash), password).catch(() => false);
    return user && ok && user.active ? user : undefined;
  }

  async create(actor: string, n: { username: string; password: string; role: Role }): Promise<PublicUser> {
    const user: User = {
      id: randomUUID(),
      username: n.username,
      passwordHash: await hashPassword(n.password),
      role: n.role,
      active: true,
      createdAt: new Date(),
    };
    await this.#ledger.appendWith(actor, "user.created", { userId: user.id, role: user.role }, (tx) =>
      this.#store.insert(user, tx),
    );
    return strip(user);
  }

  async list(): Promise<PublicUser[]> {
    return (await this.#store.list()).map(strip);
  }

  async setActive(actor: string, id: string, active: boolean): Promise<PublicUser> {
    const user = await this.#store.findById(id);
    if (!user) throw new NotFoundError("user");
    if (!active && user.username === actor) throw new ConflictError("cannot disable your own account");
    if (!active && user.active && user.role === "admin" && (await this.#store.countActiveAdmins()) <= 1) {
      throw new ConflictError("cannot disable the last active admin");
    }
    user.active = active;
    await this.#ledger.appendWith(actor, active ? "user.enabled" : "user.disabled", { userId: id }, (tx) =>
      this.#store.update(user, tx),
    );
    return strip(user);
  }

  async resetPassword(actor: string, id: string, password: string): Promise<void> {
    const user = await this.#store.findById(id);
    if (!user) throw new NotFoundError("user");
    user.passwordHash = await hashPassword(password);
    await this.#ledger.appendWith(actor, "user.password_reset", { userId: id }, (tx) =>
      this.#store.update(user, tx),
    );
  }

  async changeOwnPassword(username: string, current: string, next: string): Promise<boolean> {
    const user = await this.authenticate(username, current);
    if (!user) return false;
    user.passwordHash = await hashPassword(next);
    await this.#ledger.appendWith(username, "user.password_changed", { userId: user.id }, (tx) =>
      this.#store.update(user, tx),
    );
    return true;
  }

  /** Creates the first admin only when no active admin exists. Never overwrites accounts. */
  async ensureBootstrapAdmin(password: string): Promise<boolean> {
    if ((await this.#store.countActiveAdmins()) > 0) return false;
    await this.create("system", { username: "admin", password, role: "admin" });
    return true;
  }
}

function strip(u: User): PublicUser {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}
