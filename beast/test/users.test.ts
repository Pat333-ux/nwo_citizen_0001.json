import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";
const TEST_MFA_KEY = Buffer.alloc(32, 7);

const LONG = "correct-horse-battery";

async function setup() {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([{ username: "root", password: LONG, role: "admin" }]), ledger, TEST_MFA_KEY);
  const app = await buildApp({ jwtSecret: "z".repeat(32), users, ledger });
  const login = async (u: string, p: string) =>
    app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: u, password: p } });
  const call = (t: string | undefined, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: t ? { authorization: ["Bearer", t].join(" ") } : {} });
  const tok = async (u: string, p: string) => (await login(u, p)).json().token as string;
  return { ledger, call, login, tok };
}

test("admin creates, lists users; non-admins cannot; validation and duplicates", async () => {
  const { call, tok, login } = await setup();
  const admin = await tok("root", LONG);
  const created = await call(admin, "POST", "/v1/users", { username: "worker1", password: "another-long-pass", role: "caseworker" });
  assert.equal(created.statusCode, 201);
  assert.equal("passwordHash" in created.json(), false);
  assert.equal((await call(admin, "POST", "/v1/users", { username: "worker1", password: "another-long-pass", role: "auditor" })).statusCode, 409);
  assert.equal((await call(admin, "POST", "/v1/users", { username: "x", password: "another-long-pass", role: "auditor" })).statusCode, 400);
  assert.equal((await call(admin, "POST", "/v1/users", { username: "short1", password: "short", role: "auditor" })).statusCode, 400);
  assert.equal((await call(admin, "POST", "/v1/users", { username: "bad1", password: "another-long-pass", role: "god" })).statusCode, 400);
  const list = (await call(admin, "GET", "/v1/users")).json();
  assert.equal(list.length, 2);
  assert.equal(JSON.stringify(list).includes("argon2"), false);

  const worker = await tok("worker1", "another-long-pass");
  assert.equal((await call(worker, "GET", "/v1/users")).statusCode, 403);
  assert.equal((await call(undefined, "GET", "/v1/users")).statusCode, 403);
  assert.equal((await login("worker1", "wrong")).statusCode, 401);
});

test("disabling takes effect immediately on existing tokens and login; re-enable works", async () => {
  const { call, tok, login } = await setup();
  const admin = await tok("root", LONG);
  const w = (await call(admin, "POST", "/v1/users", { username: "worker2", password: "another-long-pass", role: "caseworker" })).json();
  const wt = await tok("worker2", "another-long-pass");
  assert.equal((await call(wt, "POST", "/v1/auth/password", { currentPassword: "wrong-password-x", newPassword: "yet-another-long-pass" })).statusCode, 401);
  assert.equal((await call(admin, "POST", `/v1/users/${w.id}/disable`)).json().active, false);
  assert.equal((await call(wt, "POST", "/v1/auth/password", { currentPassword: "wrong-password-x", newPassword: "yet-another-long-pass" })).statusCode, 403);
  assert.equal((await login("worker2", "another-long-pass")).statusCode, 401);
  await call(admin, "POST", `/v1/users/${w.id}/enable`);
  assert.equal((await login("worker2", "another-long-pass")).statusCode, 200);
  assert.equal((await call(admin, "POST", "/v1/users/does-not-exist/disable")).statusCode, 404);
});

test("cannot disable self or the last active admin", async () => {
  const { call, tok } = await setup();
  const admin = await tok("root", LONG);
  const me = (await call(admin, "GET", "/v1/users")).json()[0];
  assert.equal((await call(admin, "POST", `/v1/users/${me.id}/disable`)).statusCode, 409);
});

test("password reset by admin and self-service change; old password stops working", async () => {
  const { call, tok, login } = await setup();
  const admin = await tok("root", LONG);
  const u = (await call(admin, "POST", "/v1/users", { username: "aud1", password: "another-long-pass", role: "auditor" })).json();
  assert.equal((await call(admin, "POST", `/v1/users/${u.id}/password`, { password: "reset-by-admin-1" })).statusCode, 204);
  assert.equal((await login("aud1", "another-long-pass")).statusCode, 401);
  const t = await tok("aud1", "reset-by-admin-1");
  assert.equal((await call(t, "POST", "/v1/auth/password", { currentPassword: "nope-nope-nope", newPassword: "brand-new-password" })).statusCode, 401);
  assert.equal((await call(t, "POST", "/v1/auth/password", { currentPassword: "reset-by-admin-1", newPassword: "brand-new-password" })).statusCode, 204);
  assert.equal((await login("aud1", "brand-new-password")).statusCode, 200);
});

test("user changes are ledgered without usernames or passwords in payload; bootstrap admin only when none", async () => {
  const { call, tok, ledger } = await setup();
  const admin = await tok("root", LONG);
  await call(admin, "POST", "/v1/users", { username: "worker3", password: "another-long-pass", role: "caseworker" });
  const recs = await ledger.list();
  assert.ok(recs.some((r) => r.action === "user.created"));
  assert.equal(JSON.stringify(recs).includes("another-long-pass"), false);
  const users = new UserService(new MemoryUserStore(), ledger, TEST_MFA_KEY);
  assert.equal(await users.ensureBootstrapAdmin("bootstrap-password-1"), true);
  assert.equal(await users.ensureBootstrapAdmin("different-password-2"), false);
});
