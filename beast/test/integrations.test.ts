import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";
import { RateLimiter } from "../src/auth/ratelimit.ts";
import { createGeminiAssistant, redact } from "../src/integrations/gemini.ts";
import { createResourceLocator } from "../src/integrations/places.ts";

const PW = "correct-horse-battery";
const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });

async function setup(extra: object) {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([
    { username: "root", password: PW, role: "admin" },
    { username: "aud", password: PW, role: "auditor" },
  ]), ledger);
  const app = await buildApp({ jwtSecret: "z".repeat(32), users, ledger, ...extra });
  const tok = async (u: string) => (await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: u, password: PW } })).json().token as string;
  const h = async (u: string) => ({ authorization: ["Bearer", await tok(u)].join(" ") });
  return { app, ledger, h };
}

test("gemini client sends redacted text with key in header and parses reply", async () => {
  let seen: { url: string; headers: Record<string, string>; body: string } | undefined;
  const f = (async (url: string, init: RequestInit) => {
    seen = { url, headers: init.headers as Record<string, string>, body: init.body as string };
    return json({ candidates: [{ content: { parts: [{ text: "Hello" }] } }] });
  }) as unknown as typeof fetch;
  const ask = createGeminiAssistant("KEY", "m", f);
  assert.equal(await ask("my ssn 123-45-6789 mail a@b.co"), "Hello");
  assert.equal(seen!.headers["x-goog-api-key"], "KEY");
  assert.equal(seen!.url.includes("KEY"), false);
  assert.equal(/123-45-6789|a@b\.co/.test(seen!.body), false);
  assert.equal(redact("call 317-555-0100"), "call [redacted]");
});

test("assistant endpoint: auth, permission, rate limit, no message in ledger, upstream failure", async () => {
  const { app, ledger, h } = await setup({ assistant: async () => "ok", assistantLimiter: new RateLimiter(2, 60_000) });
  const post = async (u: string | undefined, message: unknown) =>
    app.inject({ method: "POST", url: "/v1/assistant", payload: { message }, headers: u ? await h(u) : {} });
  assert.equal((await post(undefined, "hi")).statusCode, 403);
  assert.equal((await post("aud", "hi")).statusCode, 403);
  assert.equal((await post("root", "")).statusCode, 400);
  const ok = await post("root", "secret question text");
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().reply, "ok");
  assert.equal(JSON.stringify(await ledger.list()).includes("secret question text"), false);
  assert.equal((await post("root", "again")).statusCode, 200);
  assert.equal((await post("root", "third")).statusCode, 429);

  const bad = await setup({ assistant: async () => { throw new Error("boom"); } });
  assert.equal((await bad.app.inject({ method: "POST", url: "/v1/assistant", payload: { message: "x" }, headers: await bad.h("root") })).statusCode, 502);
});

test("places client maps results, caches, and endpoint validates input", async () => {
  let calls = 0;
  const f = (async () => {
    calls++;
    return json({ places: [{ displayName: { text: "Pantry" }, formattedAddress: "1 Main", websiteUri: "https://p.example" }] });
  }) as unknown as typeof fetch;
  const locate = createResourceLocator("MAPSKEY", f);
  assert.deepEqual(await locate("Indianapolis, IN", "food"), [{ name: "Pantry", address: "1 Main", website: "https://p.example" }]);
  await locate("indianapolis, in", "food");
  assert.equal(calls, 1);

  const { app, h } = await setup({ locator: locate });
  const get = async (u: string | undefined, qs: string) => app.inject({ method: "GET", url: `/v1/resources?${qs}`, headers: u ? await h(u) : {} });
  assert.equal((await get(undefined, "near=Indianapolis&category=food")).statusCode, 403);
  assert.equal((await get("aud", "near=Indianapolis&category=food")).statusCode, 200);
  assert.equal((await get("aud", "near=x&category=food")).statusCode, 400);
  assert.equal((await get("aud", "near=Indianapolis&category=drugs")).statusCode, 400);
  assert.equal((await get("aud", "near=%3Cscript%3E&category=food")).statusCode, 400);
});
