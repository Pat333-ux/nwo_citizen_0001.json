import { test } from "node:test";
import assert from "node:assert/strict";
import { LoginThrottle } from "../src/auth/throttle.ts";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";

test("throttle locks after max failures, expires, and resets on success", () => {
  const t = new LoginThrottle(3, 1000, 5000);
  for (let i = 0; i < 3; i++) t.recordFailure("k", 0);
  assert.ok(t.isLocked("k", 100));
  assert.ok(!t.isLocked("k", 5001));
  t.recordFailure("j", 0); t.recordSuccess("j"); t.recordFailure("j", 0); t.recordFailure("j", 0);
  assert.ok(!t.isLocked("j", 1));
  t.recordFailure("w", 0); t.recordFailure("w", 0); t.recordFailure("w", 2000); // window expired, count restarts
  assert.ok(!t.isLocked("w", 2001));
});

test("login endpoint returns 429 after repeated failures, even with the right password", async () => {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([{ username: "u1", password: "correct-password-1", role: "auditor" }]), ledger);
  const app = await buildApp({ jwtSecret: "q".repeat(32), users, ledger, throttle: new LoginThrottle(3) });
  const login = (p: string) => app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "u1", password: p } });
  for (let i = 0; i < 3; i++) assert.equal((await login("bad")).statusCode, 401);
  assert.equal((await login("correct-password-1")).statusCode, 429);
});

test("dashboard is served with CSP and contains no data; scripts are external", async () => {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(new MemoryUserStore(), ledger);
  const app = await buildApp({ jwtSecret: "q".repeat(32), users, ledger });
  const page = await app.inject({ url: "/dashboard" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"] as string, /text\/html/);
  assert.match(page.headers["content-security-policy"] as string, /script-src 'self'/);
  assert.ok(page.body.includes('lang="en"'));
  assert.equal(/<script>[^<]/.test(page.body), false);
  assert.equal((await app.inject({ url: "/dashboard/app.js" })).statusCode, 200);
});
