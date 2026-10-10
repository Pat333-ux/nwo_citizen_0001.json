import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";

async function setup() {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([
    { username: "cw", password: "pw-caseworker", role: "caseworker" },
    { username: "aud", password: "pw-auditor", role: "auditor" },
  ]), ledger);
  const app = await buildApp({ jwtSecret: "x".repeat(32), users, ledger });
  const login = async (u: string, p: string) =>
    app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: u, password: p } });
  return { app, ledger, login };
}

test("login succeeds/fails; short secret rejected", async () => {
  const { app, login } = await setup();
  assert.equal((await login("cw", "pw-caseworker")).statusCode, 200);
  assert.equal((await login("cw", "wrong")).statusCode, 401);
  assert.equal((await login("nobody", "x")).statusCode, 401);
  await assert.rejects(buildApp({ jwtSecret: "short", users: undefined as never, ledger: new LedgerService(new MemoryLedgerStore()) }));
  assert.ok((await app.inject({ url: "/healthz" })).headers["x-content-type-options"]);
});

test("RBAC and ledger writes through the API", async () => {
  const { app, login } = await setup();
  const cw = (await login("cw", "pw-caseworker")).json().token;
  const aud = (await login("aud", "pw-auditor")).json().token;
  const h = (t: string) => ({ authorization: ["Bearer", t].join(" ") });

  assert.equal((await app.inject({ url: "/v1/ledger/records" })).statusCode, 403);
  assert.equal((await app.inject({ url: "/v1/ledger/records", headers: h(cw) })).statusCode, 403);
  for (const action of ["application.submitted", "application.approved"]) {
    const r = await app.inject({ method: "POST", url: "/v1/ledger/events", headers: h(cw), payload: { action, payload: { familyId: "f1" } } });
    assert.equal(r.statusCode, 201);
  }
  assert.equal((await app.inject({ method: "POST", url: "/v1/ledger/events", headers: h(aud), payload: { action: "x" } })).statusCode, 403);
  const recs = (await app.inject({ url: "/v1/ledger/records", headers: h(aud) })).json();
  assert.equal(recs.length, 2);
  assert.equal(recs[1].sequence, 1);
  assert.deepEqual((await app.inject({ url: "/v1/ledger/verify", headers: h(aud) })).json(), { valid: true });
});

test("concurrent appends keep a valid chain", async () => {
  const ledger = new LedgerService(new MemoryLedgerStore());
  await Promise.all(Array.from({ length: 20 }, (_, i) => ledger.append("a", "x", { i })));
  assert.deepEqual(await ledger.verify(), { valid: true });
  assert.equal((await ledger.list()).length, 20);
});
