import { buildApp, hashPassword, type UserRecord } from "./app.ts";
import { readFileSync } from "node:fs";
import pg from "pg";
import { CaseService } from "./cases.ts";
import { PostgresCaseStore } from "./caseStore.ts";
import { LedgerService, PostgresLedgerStore } from "../ledger/store.ts";

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

// Bootstrap admin only. Real accounts/federation (PIV/CAC, Login.gov, OIDC) are TODO.
const users = new Map<string, UserRecord>();
if (process.env.BOOTSTRAP_ADMIN_PASSWORD) {
  users.set("admin", {
    username: "admin",
    passwordHash: await hashPassword(process.env.BOOTSTRAP_ADMIN_PASSWORD),
    role: "admin",
  });
}

const piiKeyHex = process.env.PII_KEY_HEX;
if (!piiKeyHex || !/^[0-9a-f]{64}$/i.test(piiKeyHex)) throw new Error("PII_KEY_HEX (64 hex chars) is required");
const poverty = Number(process.env.POVERTY_LEVEL_MONTHLY);
if (!Number.isFinite(poverty) || poverty <= 0) throw new Error("POVERTY_LEVEL_MONTHLY is required (program-supplied)");
const rules = JSON.parse(readFileSync(new URL("../rules/rules.json", import.meta.url), "utf8"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ledger = new LedgerService(new PostgresLedgerStore(pool));

const app = await buildApp({
  cases: new CaseService(ledger, new PostgresCaseStore(pool), Buffer.from(piiKeyHex, "hex"), rules, poverty),
  jwtSecret: secret,
  users,
  ledger,
  log: (l) => console.log(l),
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
