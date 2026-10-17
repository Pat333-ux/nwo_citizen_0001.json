import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign, type JsonWebKey } from "node:crypto";
import { createGoogleVerifier } from "../src/auth/google.ts";
import { buildApp } from "../src/server/app.ts";
import { MemoryUserStore, UserService } from "../src/server/users.ts";
import { LedgerService, MemoryLedgerStore } from "../src/ledger/store.ts";

const CLIENT = "client-123.apps.googleusercontent.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" } as JsonWebKey;
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

function token(claims: object, key = privateKey, kid = "k1") {
  const e = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${e({ alg: "RS256", kid })}.${e(claims)}`;
  return `${body}.${createSign("RSA-SHA256").update(body).sign(key).toString("base64url")}`;
}
const good = { iss: "https://accounts.google.com", aud: CLIENT, sub: "g1", email: "Jane@Example.com", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 };
const verify = createGoogleVerifier(CLIENT, async () => [jwk]);

test("verifier accepts a valid token and rejects bad ones", async () => {
  assert.deepEqual(await verify(token(good)), { sub: "g1", email: "jane@example.com" });
  assert.equal(await verify(token({ ...good, aud: "other" })), undefined);
  assert.equal(await verify(token({ ...good, iss: "https://evil.example" })), undefined);
  assert.equal(await verify(token({ ...good, exp: 1 })), undefined);
  assert.equal(await verify(token({ ...good, email_verified: false })), undefined);
  assert.equal(await verify(token(good, other.privateKey)), undefined);
  assert.equal(await verify(token(good, privateKey, "unknown")), undefined);
  assert.equal(await verify("garbage"), undefined);
});

test("google login only works for admin-linked active users", async () => {
  const ledger = new LedgerService(new MemoryLedgerStore());
  const users = new UserService(await MemoryUserStore.from([{ username: "root", password: "correct-horse-battery", role: "admin" }]), ledger);
  const app = await buildApp({ jwtSecret: "z".repeat(32), users, ledger, googleVerifier: verify });
  const google = (t: string) => app.inject({ method: "POST", url: "/v1/auth/google", payload: { idToken: t } });

  assert.equal((await google(token(good))).statusCode, 401); // not linked, no auto-provisioning

  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "root", password: "correct-horse-battery" } });
  const auth = { authorization: ["Bearer", login.json().token].join(" ") };
  const [root] = await users.list();
  const link = await app.inject({ method: "POST", url: `/v1/users/${root!.id}/email`, headers: auth, payload: { email: "jane@example.com" } });
  assert.equal(link.statusCode, 200);

  const ok = await google(token(good));
  assert.equal(ok.statusCode, 200);
  assert.ok(ok.json().token);

  await users.create("system", { username: "second", password: "another-long-pass", role: "admin" });
  const l2 = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { username: "second", password: "another-long-pass" } });
  const d = await app.inject({ method: "POST", url: `/v1/users/${root!.id}/disable`, headers: { authorization: ["Bearer", l2.json().token].join(" ") } });
  assert.equal(d.statusCode, 200);
  assert.equal((await google(token(good))).statusCode, 401);
});
