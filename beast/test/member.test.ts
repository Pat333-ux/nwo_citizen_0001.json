import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, type JsonWebKey } from "node:crypto";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";
import { CaseService } from "../src/server/cases.ts";
import { MemoryCaseStore } from "../src/server/caseStore.ts";
import { createGoogleVerifier } from "../src/auth/google.ts";
import { RateLimiter } from "../src/auth/ratelimit.ts";
import { can, type Role, type Permission } from "../src/auth/rbac.ts";

const PW = "correct-horse-battery";
const CLIENT = "cid.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k" } as JsonWebKey;
const gtoken = (email: string) => {
  const e = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${e({ alg: "RS256", kid: "k" })}.${e({ iss: "https://accounts.google.com", aud: CLIENT, sub: "s", email, email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(privateKey).toString("base64url")}`;
};

async function setup(memberActions: boolean, limit = 3) {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([
    { username: "root", password: PW, role: "admin" },
    { username: "cw", password: PW, role: "caseworker" },
  ]), ledger);
  const rules: never[] = [];
  const cases = new CaseService(ledger, new MemoryCaseStore(), Buffer.alloc(32, 1), rules, 1000);
  const asked: string[] = [];
  const app = await buildApp({
    jwtSecret: "z".repeat(32), users, ledger, cases, memberActions,
    googleVerifier: createGoogleVerifier(CLIENT, async () => [jwk]),
    assistant: async (m) => { asked.push(m); return "answer"; },
    memberLimiter: new RateLimiter(limit, 60_000),
  });
  const call = (t: string | undefined, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: t ? { authorization: ["Bearer", t].join(" ") } : {} });
  const staff = async (u: string) => (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: u, password: PW } })).json().token as string;
  const google = async (email: string) => (await app.inject({ method: "POST", url: "/v1/auth/google", payload: { idToken: gtoken(email) } })).json().token as string;

  const cw = await staff("cw");
  const mk = async (name: string, email: string) => {
    const idn = (await call(cw, "POST", "/v1/identities", { type: "citizen", jurisdiction: "IN", name, address: "1 Main", email })).json();
    await call(cw, "POST", `/v1/identities/${idn.id}/verify`);
    const appn = (await call(cw, "POST", "/v1/applications", { identityId: idn.id, adults: 1, children: 0, monthlyIncome: 0, veteranStatus: false, disabilityStatus: false, housingStatus: "rent" })).json();
    const m = await call(cw, "POST", "/v1/members", { username: name.toLowerCase(), email, identityId: idn.id });
    return { identityId: idn.id as string, familyId: appn.familyId as string, member: m };
  };
  return { call, staff, google, cw, mk, asked, users, ledger };
}

test("permission matrix for member role", () => {
  const allowed: Permission[] = ["me:read", "me:act", "assistant:use", "resources:read"];
  for (const p of ["kpi:read", "ledger:read", "user:manage", "case:review", "case:read", "case:create", "case:decide", "config:write", "member:manage"] as Permission[]) {
    assert.equal(can("member", p), false, p);
  }
  for (const p of allowed) assert.equal(can("member", p), true, p);
  assert.equal(can("auditor" as Role, "member:manage"), false);
});

test("member creation rules and google-only sign-in", async () => {
  const t = await setup(false);
  const a = await t.mk("Alice", "alice@example.com");
  assert.equal(a.member.statusCode, 201);
  assert.equal("passwordHash" in a.member.json(), false);
  // duplicates and unverified identity
  assert.equal((await t.call(t.cw, "POST", "/v1/members", { username: "alice2", email: "alice@example.com", identityId: a.identityId })).statusCode, 409);
  const raw = (await t.call(t.cw, "POST", "/v1/identities", { type: "citizen", jurisdiction: "IN", name: "Bob", address: "x", email: "b@x.co" })).json();
  assert.equal((await t.call(t.cw, "POST", "/v1/members", { username: "bob", email: "bob@example.com", identityId: raw.id })).statusCode, 409);
  // not for non-staff, not via admin user endpoint, no password login
  const tok = await t.google("alice@example.com");
  assert.ok(tok);
  assert.equal((await t.call(tok, "POST", "/v1/members", { username: "x1x", email: "c@example.com", identityId: a.identityId })).statusCode, 403);
  const adm = await t.staff("root");
  assert.equal((await t.call(adm, "POST", "/v1/users", { username: "sneaky", password: PW, role: "member" })).statusCode, 400);
  const login = await t.call(undefined, "POST", "/v1/auth/login", { username: "alice", password: PW });
  assert.equal(login.statusCode, 401);
  // unlinked google account still rejected
  assert.equal(await t.google("nobody@example.com"), undefined);
});

test("members are isolated: no staff routes, only their own data", async () => {
  const t = await setup(true, 100);
  const a = await t.mk("Alice", "alice@example.com");
  const b = await t.mk("Bobby", "bobby@example.com");
  const ta = await t.google("alice@example.com");
  const tb = await t.google("bobby@example.com");

  for (const [m, u] of [["GET", "/v1/kpis"], ["GET", "/v1/ledger/records"], ["GET", "/v1/ledger/root"], ["GET", "/v1/users"], ["GET", `/v1/applications/${a.familyId}/recommendations`], ["POST", `/v1/applications/${a.familyId}/start-review`]] as const) {
    assert.equal((await t.call(ta, m, u)).statusCode, 403, u);
  }
  const mine = (await t.call(ta, "GET", "/v1/me/applications")).json();
  assert.deepEqual(mine.map((x: { familyId: string }) => x.familyId), [a.familyId]);
  assert.deepEqual(Object.keys(mine[0]).sort(), ["familyId", "status"]);
  assert.deepEqual((await t.call(tb, "GET", "/v1/me/applications")).json().map((x: { familyId: string }) => x.familyId), [b.familyId]);

  // Alice cannot act on Bob's application; her own works.
  assert.equal((await t.call(ta, "POST", `/v1/me/applications/${b.familyId}/submit`)).statusCode, 404);
  assert.equal((await t.call(ta, "POST", `/v1/me/applications/${b.familyId}/appeal`)).statusCode, 404);
  assert.equal((await t.call(tb, "GET", "/v1/me/applications")).json()[0].status, "draft");
  const ok = await t.call(ta, "POST", `/v1/me/applications/${a.familyId}/submit`);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().status, "submitted");
  assert.equal((await t.call(ta, "POST", `/v1/me/applications/${a.familyId}/appeal`)).statusCode, 409); // invalid transition
  // staff do not have /me application routes
  assert.equal((await t.call(t.cw, "GET", "/v1/me/applications")).statusCode, 403);
  assert.equal((await t.call(undefined, "GET", "/v1/me")).statusCode, 403);
});

test("member actions are off by default", async () => {
  const t = await setup(false);
  const a = await t.mk("Alice", "alice@example.com");
  const ta = await t.google("alice@example.com");
  assert.equal((await t.call(ta, "POST", `/v1/me/applications/${a.familyId}/submit`)).statusCode, 404);
  assert.equal((await t.call(ta, "GET", "/v1/me/applications")).statusCode, 200);
});

test("assistant needs consent for members, is rate limited, ledger has no text", async () => {
  const t = await setup(false);
  await t.mk("Alice", "alice@example.com");
  const ta = await t.google("alice@example.com");
  assert.equal((await t.call(ta, "GET", "/v1/me")).json().consentAccepted, false);
  assert.equal((await t.call(ta, "POST", "/v1/assistant", { message: "hello there" })).statusCode, 403);
  assert.deepEqual(t.asked, []);
  assert.equal((await t.call(ta, "POST", "/v1/me/consent")).statusCode, 204);
  assert.equal((await t.call(ta, "GET", "/v1/me")).json().consentAccepted, true);
  assert.equal((await t.call(ta, "POST", "/v1/assistant", { message: "private words" })).statusCode, 200);
  assert.equal(JSON.stringify(await t.ledger.list()).includes("private words"), false);
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await t.call(ta, "POST", "/v1/assistant", { message: "again" })).statusCode);
  assert.ok(codes.includes(429));
});

test("disabled members lose access immediately", async () => {
  const t = await setup(false);
  const a = await t.mk("Alice", "alice@example.com");
  const ta = await t.google("alice@example.com");
  const adm = await t.staff("root");
  assert.equal((await t.call(adm, "POST", `/v1/users/${a.member.json().id}/disable`)).statusCode, 200);
  assert.equal((await t.call(ta, "GET", "/v1/me")).statusCode, 403);
  assert.equal(await t.google("alice@example.com"), undefined);
});
