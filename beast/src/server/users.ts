import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import pg from "pg";
import type { Role } from "../auth/rbac.ts";
import { decryptPII, encryptPII } from "../crypto/pii.ts";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../auth/totp.ts";
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
  totpSecret?: string;
  mfaEnabled: boolean;
  mfaLastStep: number;
}

export type PublicUser = Omit<User, "passwordHash" | "totpSecret" | "mfaLastStep">;

export interface UserStore {
  insert(u: User): Promise<void>; // throws ConflictError on duplicate username
  findById(id: string): Promise<User | undefined>;
  findByUsername(username: string): Promise<User | undefined>;
  list(): Promise<User[]>;
  update(u: User): Promise<void>;
  countActiveAdmins(): Promise<number>;
}

export class MemoryUserStore implements UserStore {
  #users = new Map<string, User>();

  static async from(seed: { username: string; password: string; role: Role }[]): Promise<MemoryUserStore> {
    const s = new MemoryUserStore();
    for (const u of seed) {
      await s.insert({ id: randomUUID(), username: u.username, passwordHash: await hashPassword(u.password), role: u.role, active: true, createdAt: new Date(), mfaEnabled: false, mfaLastStep: 0 });
    }
    return s;
  }
  async insert(u: User): Promise<void> {
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
  async update(u: User): Promise<void> {
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
    totpSecret: (w.totp_secret as string | null) ?? undefined,
    mfaEnabled: (w.mfa_enabled as boolean | undefined) ?? false,
    mfaLastStep: Number(w.mfa_last_step ?? 0),
  };
}

export class PostgresUserStore implements UserStore {
  #pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }
  async insert(u: User): Promise<void> {
    try {
      await this.#pool.query(
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
  async update(u: User): Promise<void> {
    await this.#pool.query("UPDATE users SET password_hash=$2, role=$3, active=$4, totp_secret=$5, mfa_enabled=$6, mfa_last_step=$7 WHERE id=$1",
      [u.id, u.passwordHash, u.role, u.active, u.totpSecret ?? null, u.mfaEnabled, u.mfaLastStep],
    );
  }
  async countActiveAdmins() {
    const r = await this.#pool.query("SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active");
    return r.rows[0].n as number;
  }
}

/** Encrypted secrets are `iv.tag.ciphertext`; anything else is a legacy plaintext base32 secret. */
const isEncrypted = (stored: string): boolean => stored.includes(".");

export const MIN_PASSWORD_LENGTH = 12;

export class UserService {
  #store: UserStore;
  #ledger: LedgerService;
  // Fixed hash so unknown usernames cost the same time as wrong passwords.
  #dummyHash: Promise<string> = hashPassword("not-a-real-password");
  #mfaKey: Buffer;

  /** `mfaKey` (32 bytes, separate from the PII key; KMS-managed in production) encrypts TOTP secrets at rest with AES-256-GCM. */
  constructor(store: UserStore, ledger: LedgerService, mfaKey: Buffer) {
    if (mfaKey.length !== 32) throw new Error("MFA key must be 32 bytes");
    this.#store = store;
    this.#ledger = ledger;
    this.#mfaKey = mfaKey;
  }

  /** Stored secrets are `iv.tag.ciphertext`; a value with no dots is a legacy plaintext secret. */
  #plainSecret(stored: string): string {
    return isEncrypted(stored) ? decryptPII(stored, this.#mfaKey) : stored;
  }

  /** Encrypts any legacy plaintext TOTP secrets. Safe to run repeatedly; returns the number upgraded. */
  async migrateMfaSecrets(): Promise<number> {
    let n = 0;
    for (const u of await this.#store.list()) {
      if (u.totpSecret && !isEncrypted(u.totpSecret)) {
        u.totpSecret = encryptPII(u.totpSecret, this.#mfaKey);
        await this.#store.update(u);
        n++;
      }
    }
    return n;
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
      mfaEnabled: false,
      mfaLastStep: 0,
    };
    await this.#store.insert(user);
    await this.#ledger.append(actor, "user.created", { userId: user.id, role: user.role });
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
    await this.#ledger.append(actor, active ? "user.enabled" : "user.disabled", { userId: id });
    await this.#store.update(user);
    return strip(user);
  }

  async resetPassword(actor: string, id: string, password: string): Promise<void> {
    const user = await this.#store.findById(id);
    if (!user) throw new NotFoundError("user");
    user.passwordHash = await hashPassword(password);
    await this.#ledger.append(actor, "user.password_reset", { userId: id });
    await this.#store.update(user);
  }

  async changeOwnPassword(username: string, current: string, next: string): Promise<boolean> {
    const user = await this.authenticate(username, current);
    if (!user) return false;
    user.passwordHash = await hashPassword(next);
    await this.#ledger.append(username, "user.password_changed", { userId: user.id });
    await this.#store.update(user);
    return true;
  }

  /** Aggregates only. MFA compliance covers active accounts. */
  async stats(): Promise<{ activeUsers: number; mfaEnrolled: number; mfaCompliancePercent: number }> {
    const active = (await this.#store.list()).filter((u) => u.active);
    const mfaEnrolled = active.filter((u) => u.mfaEnabled).length;
    return {
      activeUsers: active.length,
      mfaEnrolled,
      mfaCompliancePercent: active.length ? Math.round((mfaEnrolled / active.length) * 100) : 100,
    };
  }

  /** Starts (or restarts) enrollment. The factor is not active until confirmMfa succeeds. */
  async beginMfaEnrollment(username: string): Promise<{ secret: string; otpauthUri: string }> {
    const user = await this.#store.findByUsername(username);
    if (!user) throw new NotFoundError("user");
    if (user.mfaEnabled) throw new ConflictError("MFA already enabled");
    const secret = generateTotpSecret();
    user.totpSecret = encryptPII(secret, this.#mfaKey);
    await this.#store.update(user);
    return { secret, otpauthUri: otpauthUri("BEAST", user.username, secret) };
  }

  async confirmMfa(username: string, code: string): Promise<boolean> {
    const user = await this.#store.findByUsername(username);
    if (!user?.totpSecret || user.mfaEnabled) return false;
    const step = verifyTotp(this.#plainSecret(user.totpSecret), code, user.mfaLastStep);
    if (step === undefined) return false;
    user.mfaEnabled = true;
    user.mfaLastStep = step;
    await this.#ledger.append(username, "user.mfa_enabled", { userId: user.id });
    await this.#store.update(user);
    return true;
  }

  /** Verifies a code for an MFA-enabled user and records the step so it cannot be replayed. */
  async checkMfaCode(user: User, code: string | undefined): Promise<boolean> {
    if (!user.mfaEnabled || !user.totpSecret || !code) return false;
    const step = verifyTotp(this.#plainSecret(user.totpSecret), code, user.mfaLastStep);
    if (step === undefined) return false;
    user.mfaLastStep = step;
    if (!isEncrypted(user.totpSecret)) user.totpSecret = encryptPII(user.totpSecret, this.#mfaKey);
    await this.#store.update(user);
    return true;
  }

  async resetMfa(actor: string, id: string): Promise<void> {
    const user = await this.#store.findById(id);
    if (!user) throw new NotFoundError("user");
    user.totpSecret = undefined;
    user.mfaEnabled = false;
    user.mfaLastStep = 0;
    await this.#ledger.append(actor, "user.mfa_reset", { userId: id });
    await this.#store.update(user);
  }

  /** Creates the first admin only when no active admin exists. Never overwrites accounts. */
  async ensureBootstrapAdmin(password: string): Promise<boolean> {
    if ((await this.#store.countActiveAdmins()) > 0) return false;
    await this.create("system", { username: "admin", password, role: "admin" });
    return true;
  }
}

function strip(u: User): PublicUser {
  const { passwordHash: _p, totpSecret: _t, mfaLastStep: _l, ...rest } = u;
  return rest;
}
