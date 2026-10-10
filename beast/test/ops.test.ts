import { test } from "node:test";
import assert from "node:assert/strict";
import { Metrics, runHealthChecks } from "../src/ops/metrics.ts";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";

const PW = "correct-horse-battery";

test("health checks raise critical alerts for DB outage and ledger failure", async () => {
  const m = new Metrics();
  const alerts: string[] = [] as string[];
  const alert = (s: string, msg: string): void => { alerts.push(`${s}:${msg}`); };
  await runHealthChecks({ ping: async () => {}, verifyLedger: async () => ({ valid: true }) }, m, alert);
  assert.equal(alerts.length, 0);
  await runHealthChecks({ ping: async () => { throw new Error("down"); }, verifyLedger: async () => ({ valid: true }) }, m, alert);
  await runHealthChecks({ ping: async () => {}, verifyLedger: async () => ({ valid: false }) }, m, alert);
  assert.equal(alerts.length, 2);
  assert.ok(alerts.every((a) => a.startsWith("critical:")));
  const s = m.snapshot();
  assert.equal(s.db_check_failures, 1);
  assert.equal(s.ledger_verify_failures, 1);
  assert.equal(s.ledger_valid, 0);
});

test("metrics count failed logins and MFA resets, and are readable only by ops roles", async () => {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([
    { username: "adm", password: PW, role: "admin" },
    { username: "cw", password: PW, role: "caseworker" },
  ]), ledger, Buffer.alloc(32, 7));
  const metrics = new Metrics();
  const app = await buildApp({ jwtSecret: "o".repeat(32), users, ledger, metrics });
  const login = (u: string, p: string) => app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: u, password: p } });
  await login("adm", "wrong-password-1");
  await login("nobody", "wrong-password-2");
  const adm = (await login("adm", PW)).json().token as string;
  const cw = (await login("cw", PW)).json().token as string;
  const h = (t: string) => ({ authorization: ["Bearer", t].join(" ") });
  const cwId = (await app.inject({ url: "/v1/users", headers: h(adm) })).json().find((u: { username: string }) => u.username === "cw").id;
  await app.inject({ method: "POST", url: `/v1/users/${cwId}/mfa/reset`, headers: h(adm) });
  assert.equal((await app.inject({ url: "/v1/ops/metrics", headers: h(cw) })).statusCode, 403);
  const r = await app.inject({ url: "/v1/ops/metrics", headers: h(adm) });
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /beast_failed_logins 2/);
  assert.match(r.body, /beast_mfa_resets 1/);
  assert.equal(r.body.includes("adm"), false);
});

test("MFA confirm is throttled and alert webhook receives alerts", async () => {
  const { makeAlerter } = await import("../src/ops/metrics.ts");
  const { createServer } = await import("node:http");
  let got = "";
  const srv = createServer((req, res) => { req.on("data", (c) => (got += c)); req.on("end", () => res.end("ok")); });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const lines: string[] = [];
  makeAlerter((l) => lines.push(l), `http://127.0.0.1:${(srv.address() as { port: number }).port}`)("critical", "boom");
  for (let i = 0; i < 50 && !got; i++) await new Promise((r) => setTimeout(r, 20));
  assert.match(got, /"severity":"critical"/);
  assert.match(lines[0]!, /"alert":true/);
  srv.close();

  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([{ username: "u1", password: PW, role: "caseworker" }]), ledger, Buffer.alloc(32, 7));
  const app = await buildApp({ jwtSecret: "t".repeat(32), users, ledger, requireMfa: true });
  const tok = (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "u1", password: PW } })).json().token as string;
  const h = { authorization: ["Bearer", tok].join(" ") };
  await app.inject({ method: "POST", url: "/v1/auth/mfa/enroll", headers: h });
  const codes: number[] = [];
  for (let i = 0; i < 6; i++) codes.push((await app.inject({ method: "POST", url: "/v1/auth/mfa/confirm", headers: h, payload: { code: "000000" } })).statusCode);
  assert.deepEqual(codes, [401, 401, 401, 401, 401, 429]);
});
