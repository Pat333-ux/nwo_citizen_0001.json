import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildApp, hashPassword, type UserRecord } from "../src/server/app.ts";
import { CaseService } from "../src/server/cases.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";

async function setup() {
  const users = new Map<string, UserRecord>([
    ["cw", { username: "cw", passwordHash: await hashPassword("pw-caseworker"), role: "caseworker" }],
    ["aud", { username: "aud", passwordHash: await hashPassword("pw-auditor"), role: "auditor" }],
    ["adm", { username: "adm", passwordHash: await hashPassword("pw-admin"), role: "admin" }],
  ]);
  const ledger = new LedgerService(new MemoryLedgerStore());
  const rules = JSON.parse(readFileSync(new URL("../src/rules/rules.json", import.meta.url), "utf8"));
  const cases = new CaseService(ledger, randomBytes(32), rules, 2000);
  const app = await buildApp({ jwtSecret: "y".repeat(32), users, ledger, cases });
  const tok = async (u: string, p: string) =>
    (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: u, password: p } })).json().token as string;
  const call = (t: string, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: ["Bearer", t].join(" ") } });
  return { ledger, call, cw: await tok("cw", "pw-caseworker"), aud: await tok("aud", "pw-auditor"), adm: await tok("adm", "pw-admin") };
}

test("Sprint 1 flow over the API, with ledger verification and no PII in the ledger", async () => {
  const { call, cw, aud, adm, ledger } = await setup();
  const idr = await call(cw, "POST", "/v1/identities", { type: "citizen", jurisdiction: "US-IN", name: "Jane Doe", address: "1 Main St", email: "jane@example.com" });
  assert.equal(idr.statusCode, 201);
  const identity = idr.json();
  assert.equal(JSON.stringify(identity).includes("Jane"), false);

  const early = await call(cw, "POST", "/v1/applications", { identityId: identity.id, adults: 1, children: 2, monthlyIncome: 1200, veteranStatus: false, disabilityStatus: false, housingStatus: "renting" });
  assert.equal(early.statusCode, 409); // not verified yet
  assert.equal((await call(cw, "POST", `/v1/identities/${identity.id}/verify`)).json().verificationLevel, 1);

  const app = (await call(cw, "POST", "/v1/applications", { identityId: identity.id, adults: 1, children: 2, monthlyIncome: 1200, veteranStatus: false, disabilityStatus: false, housingStatus: "renting" })).json();
  assert.equal(app.status, "draft");
  assert.equal((await call(cw, "POST", `/v1/applications/${app.familyId}/submit`)).json().status, "submitted");
  assert.deepEqual((await call(cw, "GET", `/v1/applications/${app.familyId}/recommendations`)).json(), [{ program: "Food Assistance", reason: "Income below threshold" }]);
  assert.equal((await call(cw, "POST", `/v1/applications/${app.familyId}/decision`, { decision: "approved" })).statusCode, 409); // must be reviewed first
  assert.equal((await call(cw, "POST", `/v1/applications/${app.familyId}/start-review`)).json().status, "in_review");
  assert.equal((await call(aud, "POST", `/v1/applications/${app.familyId}/decision`, { decision: "approved" })).statusCode, 403);
  assert.equal((await call(cw, "POST", `/v1/applications/${app.familyId}/decision`, { decision: "approved" })).json().status, "approved");

  assert.deepEqual((await call(adm, "GET", "/v1/kpis")).json(), { familiesServed: 1, applicationsPending: 0, activeCitizens: 1, approvals: 1, denials: 0, appeals: 0 });
  assert.deepEqual((await call(aud, "GET", "/v1/ledger/verify")).json(), { valid: true });
  const root = (await call(aud, "GET", "/v1/ledger/root")).json();
  assert.equal(root.records, 6);
  assert.equal(root.root.length, 64);
  const all = JSON.stringify(await ledger.list());
  for (const pii of ["Jane", "1 Main St", "jane@example.com"]) assert.equal(all.includes(pii), false);
});

test("validation, 404 and denial/appeal path", async () => {
  const { call, cw } = await setup();
  assert.equal((await call(cw, "POST", "/v1/identities", { type: "alien" })).statusCode, 400);
  assert.equal((await call(cw, "GET", "/v1/applications/nope/recommendations")).statusCode, 404);
  const id = (await call(cw, "POST", "/v1/identities", { type: "citizen", jurisdiction: "US-IN", name: "A", address: "B", email: "c@d.e" })).json();
  await call(cw, "POST", `/v1/identities/${id.id}/verify`);
  const a = (await call(cw, "POST", "/v1/applications", { identityId: id.id, adults: 1, children: 0, monthlyIncome: 5000, veteranStatus: true, disabilityStatus: false, housingStatus: "own" })).json();
  await call(cw, "POST", `/v1/applications/${a.familyId}/submit`);
  await call(cw, "POST", `/v1/applications/${a.familyId}/start-review`);
  assert.equal((await call(cw, "POST", `/v1/applications/${a.familyId}/decision`, { decision: "denied" })).json().status, "denied");
  assert.equal((await call(cw, "POST", `/v1/applications/${a.familyId}/appeal`)).json().status, "appealed");
  assert.equal((await call(cw, "POST", `/v1/applications/${a.familyId}/start-review`)).json().status, "in_review");
});
