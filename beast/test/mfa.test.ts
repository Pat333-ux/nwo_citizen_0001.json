import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";
import { currentStep, totpAt, verifyTotp } from "../src/auth/totp.ts";
const TEST_MFA_KEY = Buffer.alloc(32, 7);

const PW = "correct-horse-battery";

test("TOTP matches RFC 6238 SHA-1 vectors and rejects replay/bad codes", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // ASCII "12345678901234567890"
  assert.equal(totpAt(secret, Math.floor(59 / 30)), "287082");
  assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), "081804");
  const now = 59_000;
  assert.equal(verifyTotp(secret, "287082", 0, now), 1);
  assert.equal(verifyTotp(secret, "287082", 1, now), undefined);
  assert.equal(verifyTotp(secret, "000000", 0, now), undefined);
  assert.equal(verifyTotp(secret, "abc", 0, now), undefined);
});

async function setup() {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([
    { username: "root", password: PW, role: "admin" },
    { username: "cw", password: PW, role: "caseworker" },
  ]), ledger, TEST_MFA_KEY);
  const app = await buildApp({ jwtSecret: "m".repeat(32), users, ledger, requireMfa: true });
  const login = (username: string, otp?: string) =>
    app.inject({ method: "POST", url: "/v1/auth/login", payload: { username, password: PW, otp } });
  const call = (t: string, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: ["Bearer", t].join(" ") } });
  return { ledger, login, call };
}

test("MFA is mandatory: unenrolled tokens only reach enrollment; enrolled login needs a code", async () => {
  const { login, call, ledger } = await setup();
  const pending = (await login("cw")).json().token as string;
  assert.equal((await call(pending, "GET", "/v1/users")).statusCode, 403);
  assert.equal((await call(pending, "POST", "/v1/auth/password", { currentPassword: PW, newPassword: "another-long-pass" })).statusCode, 403);

  const enr = (await call(pending, "POST", "/v1/auth/mfa/enroll")).json();
  assert.match(enr.otpauthUri, /^otpauth:\/\/totp\//);
  assert.equal((await call(pending, "POST", "/v1/auth/mfa/confirm", { code: "000000" })).statusCode, 401);
  const step = currentStep();
  assert.equal((await call(pending, "POST", "/v1/auth/mfa/confirm", { code: totpAt(enr.secret, step) })).statusCode, 204);
  assert.equal((await call(pending, "POST", "/v1/auth/mfa/enroll")).statusCode, 409);

  assert.equal((await login("cw")).statusCode, 401);
  assert.equal((await login("cw", "000000")).statusCode, 401);
  // The enrollment code is already used, so it cannot be replayed to log in.
  assert.equal((await login("cw", totpAt(enr.secret, step))).statusCode, 401);
  const ok = await login("cw", totpAt(enr.secret, step + 1));
  assert.equal(ok.statusCode, 200);
  assert.equal((await call(ok.json().token, "POST", "/v1/auth/password", { currentPassword: "wrong-password-x", newPassword: "another-long-pass" })).statusCode, 401);
  assert.deepEqual(await ledger.verify(), { valid: true });
  assert.ok((await ledger.list()).some((r) => r.action === "user.mfa_enabled"));
});

test("admin can reset a user's MFA, which forces re-enrollment", async () => {
  const { login, call } = await setup();
  const admin = (await login("root")).json().token as string;
  const e = (await call(admin, "POST", "/v1/auth/mfa/enroll")).json();
  await call(admin, "POST", "/v1/auth/mfa/confirm", { code: totpAt(e.secret, currentStep()) });
  const admin2 = (await login("root", totpAt(e.secret, currentStep() + 1))).json().token as string;
  const cwId = (await call(admin2, "GET", "/v1/users")).json().find((u: { username: string }) => u.username === "cw").id;
  const listed = (await call(admin2, "GET", "/v1/users")).body;
  assert.equal(listed.includes("totp"), false);
  assert.equal((await call(admin2, "POST", `/v1/users/${cwId}/mfa/reset`)).statusCode, 204);
  assert.equal((await login("cw")).statusCode, 200);
});

test("TOTP secrets are encrypted at rest; legacy plaintext is upgraded; wrong key cannot read", async () => {
  const { MemoryUserStore: MS } = await import("../src/server/users.ts");
  const store = await MS.from([{ username: "u1", password: PW, role: "caseworker" }]);
  const ledger = new LedgerService(new MemoryLedgerStore());
  const svc = new UserService(store, ledger, TEST_MFA_KEY);
  const { secret } = await svc.beginMfaEnrollment("u1");
  const stored = (await store.findByUsername("u1"))!.totpSecret!;
  assert.notEqual(stored, secret);
  assert.equal(stored.includes(secret), false);
  assert.equal(stored.split(".").length, 3);
  assert.equal(await svc.confirmMfa("u1", totpAt(secret, currentStep())), true);

  const other = new UserService(store, ledger, Buffer.alloc(32, 9));
  await assert.rejects(other.checkMfaCode((await store.findByUsername("u1"))!, totpAt(secret, currentStep() + 1)));

  // Legacy plaintext secret still works, and is encrypted by migration.
  const legacy = (await store.findByUsername("u1"))!;
  legacy.totpSecret = secret;
  await store.update(legacy);
  assert.equal(await svc.migrateMfaSecrets(), 1);
  assert.equal(await svc.migrateMfaSecrets(), 0);
  assert.equal((await store.findByUsername("u1"))!.totpSecret!.includes(secret), false);
  assert.equal(await svc.checkMfaCode((await store.findByUsername("u1"))!, totpAt(secret, currentStep() + 1)), true);
});
