import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { MemoryCaseStore } from "../src/server/caseStore.ts";
import { CaseService } from "../src/server/cases.ts";
import { MemoryProgramStore, ProgramService } from "../src/server/programs.ts";
import { AnchorService, EthereumRpcAnchorer, LocalAnchorer, MemoryAnchorStore } from "../src/anchor/anchor.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";
import { merkleRoot } from "../src/crypto/merkle.ts";

const PW = "correct-horse-battery";

async function setup(anchorer = new LocalAnchorer()) {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([
    { username: "cw", password: PW, role: "caseworker" },
    { username: "aud", password: PW, role: "auditor" },
    { username: "adm", password: PW, role: "admin" },
  ]), ledger);
  const rules = JSON.parse(readFileSync(new URL("../src/rules/rules.json", import.meta.url), "utf8"));
  const programs = new ProgramService(new MemoryProgramStore(), ledger);
  const cases = new CaseService(ledger, new MemoryCaseStore(), randomBytes(32), rules, 2000, programs);
  const anchors = new AnchorService(ledger, new MemoryAnchorStore(), anchorer);
  const app = await buildApp({ jwtSecret: "p".repeat(32), users, ledger, cases, programs, anchors });
  const tok = async (u: string) =>
    (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: u, password: PW } })).json().token as string;
  const call = (t: string, method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { authorization: ["Bearer", t].join(" ") } });
  return { ledger, anchors, call, cw: await tok("cw"), aud: await tok("aud"), adm: await tok("adm") };
}

const person = { type: "citizen", jurisdiction: "US-IN", name: "Jane Doe", address: "1 Main St", email: "jane@example.com" };
const appl = { adults: 1, children: 1, monthlyIncome: 900, veteranStatus: false, disabilityStatus: false, housingStatus: "renting" };

test("program registry: six defaults, admin-managed, applications bound to active programs", async () => {
  const { call, cw, aud, adm } = await setup();
  const list = (await call(cw, "GET", "/v1/programs")).json();
  assert.deepEqual(list.map((p: { id: string }) => p.id), ["family-first", "housing", "employment", "veteran-support", "food-security", "education"]);
  assert.equal((await call(cw, "POST", "/v1/programs", { id: "transit", name: "Transit" })).statusCode, 403);
  assert.equal((await call(adm, "POST", "/v1/programs", { id: "transit", name: "Transit" })).statusCode, 201);
  assert.equal((await call(adm, "POST", "/v1/programs", { id: "transit", name: "Transit" })).statusCode, 409);
  assert.equal((await call(adm, "POST", "/v1/programs", { id: "x1", name: "X", ruleSet: "nope" })).statusCode, 409);
  assert.equal((await call(adm, "POST", "/v1/programs", { id: "Bad Id", name: "X" })).statusCode, 400);
  assert.equal((await call(aud, "GET", "/v1/programs")).statusCode, 200);

  const id = (await call(cw, "POST", "/v1/identities", person)).json();
  await call(cw, "POST", `/v1/identities/${id.id}/verify`);
  const ff = (await call(cw, "POST", "/v1/applications", { identityId: id.id, ...appl })).json();
  assert.equal(ff.programId, "family-first");
  assert.equal((await call(cw, "GET", `/v1/applications/${ff.familyId}/recommendations`)).json().length > 0, true);
  const hs = (await call(cw, "POST", "/v1/applications", { identityId: id.id, programId: "housing", ...appl })).json();
  assert.equal(hs.programId, "housing");
  assert.deepEqual((await call(cw, "GET", `/v1/applications/${hs.familyId}/recommendations`)).json(), []);
  assert.equal((await call(cw, "POST", "/v1/applications", { identityId: id.id, programId: "missing", ...appl })).statusCode, 404);
  await call(adm, "POST", "/v1/programs/housing/disable");
  assert.equal((await call(cw, "POST", "/v1/applications", { identityId: id.id, programId: "housing", ...appl })).statusCode, 409);
});

test("executive dashboard summary is aggregate-only and reflects health", async () => {
  const { call, cw, aud } = await setup();
  const id = (await call(cw, "POST", "/v1/identities", person)).json();
  await call(cw, "POST", `/v1/identities/${id.id}/verify`);
  const a = (await call(cw, "POST", "/v1/applications", { identityId: id.id, ...appl })).json();
  await call(cw, "POST", `/v1/applications/${a.familyId}/submit`);
  const r = await call(aud, "GET", "/v1/dashboard/summary");
  assert.equal(r.statusCode, 200);
  const d = r.json();
  assert.equal(d.applications, 1);
  assert.equal(d.pending, 1);
  assert.equal(d.activeUsers, 3);
  assert.deepEqual(d.ledgerHealth.valid, true);
  assert.deepEqual(d.mfaCompliance, { enrolled: 0, activeUsers: 3, percent: 0 });
  assert.equal(d.lastAnchor, null);
  const text = r.body;
  for (const banned of [id.id, a.familyId, "Jane", "jane@", "1 Main"]) assert.equal(text.includes(banned), false, banned);
  for (const name of ["cw", "aud", "adm"]) assert.equal(text.includes(`"${name}"`), false, name);
});

test("anchoring: publishes current root once per change, only for admins, and records it in the ledger", async () => {
  const { call, cw, aud, adm, ledger, anchors } = await setup();
  await ledger.append("x", "a.b", {});
  const expected = merkleRoot((await ledger.list()).map((r) => r.currentHash));
  assert.equal((await call(cw, "POST", "/v1/anchors")).statusCode, 403);
  assert.equal((await call(aud, "POST", "/v1/anchors")).statusCode, 403);
  const first = await call(adm, "POST", "/v1/anchors");
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().anchor.root, expected);
  assert.equal(first.json().anchor.network, "local-only");
  const again = await call(adm, "POST", "/v1/anchors");
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().anchored, false); // only the anchor's own record was added
  assert.ok((await ledger.list()).some((r) => r.action === "ledger.anchored"));
  await ledger.append("x", "c.d", {});
  assert.equal((await call(adm, "POST", "/v1/anchors")).json().anchored, true);
  assert.equal((await call(aud, "GET", "/v1/anchors")).json().length, 2);
  assert.deepEqual(await ledger.verify(), { valid: true });
  assert.ok(await anchors.latest());
});

test("anchoring refuses a missing ledger and a failing publisher leaves no anchor", async () => {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const failing = { network: "x", publish: async (): Promise<string> => { throw new Error("rpc down"); } };
  const svc = new AnchorService(ledger, new MemoryAnchorStore(), failing);
  assert.equal((await svc.anchorNow("system")).anchored, false);
  await ledger.append("x", "a.b", {});
  await assert.rejects(svc.anchorNow("system"), /rpc down/);
  assert.equal((await svc.list()).length, 0);
});

test("Ethereum RPC anchorer sends the root as transaction data and validates the reply", async () => {
  let seen: { method: string; params: { from: string; to: string; data: string; value: string }[] } | undefined;
  let reply: object = { jsonrpc: "2.0", id: 1, result: "0x" + "ab".repeat(32) };
  const server = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { seen = JSON.parse(b); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(reply)); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const from = "0x" + "11".repeat(20);
  const a = new EthereumRpcAnchorer({ rpcUrl: `http://127.0.0.1:${port}`, from, network: "sepolia" });
  const root = "cd".repeat(32);
  assert.equal(await a.publish(root), "0x" + "ab".repeat(32));
  assert.equal(seen?.method, "eth_sendTransaction");
  assert.equal(seen?.params[0]?.data, "0x" + root);
  assert.equal(seen?.params[0]?.value, "0x0");
  reply = { jsonrpc: "2.0", id: 1, error: { message: "nope" } };
  await assert.rejects(a.publish(root), /nope/);
  assert.throws(() => new EthereumRpcAnchorer({ rpcUrl: "http://x", from: "bad", network: "n" }));
  server.close();
});
