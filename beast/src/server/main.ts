import { buildApp } from "./app.ts";
import { PostgresUserStore, UserService } from "./users.ts";
import { readFileSync } from "node:fs";
import pg from "pg";
import { CaseService } from "./cases.ts";
import { PostgresCaseStore } from "./caseStore.ts";
import { AnchorService, EthereumRpcAnchorer, LocalAnchorer, PostgresAnchorStore, startAnchorSchedule } from "../anchor/anchor.ts";
import { Metrics, makeAlerter, startHealthSchedule } from "../ops/metrics.ts";
import { PostgresProgramStore, ProgramService } from "./programs.ts";
import { LedgerService, PostgresLedgerStore } from "../ledger/store.ts";

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const piiKeyHex = process.env.PII_KEY_HEX;
if (!piiKeyHex || !/^[0-9a-f]{64}$/i.test(piiKeyHex)) throw new Error("PII_KEY_HEX (64 hex chars) is required");
const poverty = Number(process.env.POVERTY_LEVEL_MONTHLY);
if (!Number.isFinite(poverty) || poverty <= 0) throw new Error("POVERTY_LEVEL_MONTHLY is required (program-supplied)");
const rules = JSON.parse(readFileSync(new URL("../rules/rules.json", import.meta.url), "utf8"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const ledger = new LedgerService(new PostgresLedgerStore(pool));

const mfaKeyHex = process.env.MFA_KEY_HEX;
if (!mfaKeyHex || !/^[0-9a-f]{64}$/i.test(mfaKeyHex)) throw new Error("MFA_KEY_HEX (64 hex chars, different from PII_KEY_HEX) is required");
if (mfaKeyHex.toLowerCase() === piiKeyHex.toLowerCase()) throw new Error("MFA_KEY_HEX must differ from PII_KEY_HEX");
const users = new UserService(new PostgresUserStore(pool), ledger, Buffer.from(mfaKeyHex, "hex"));
const upgraded = await users.migrateMfaSecrets();
if (upgraded > 0) console.log(`encrypted ${upgraded} legacy MFA secret(s)`);
// First admin only; never overwrites existing accounts. Federation (PIV/CAC, Login.gov, OIDC) is TODO.
if (process.env.BOOTSTRAP_ADMIN_PASSWORD && (await users.ensureBootstrapAdmin(process.env.BOOTSTRAP_ADMIN_PASSWORD))) {
  console.log("bootstrap admin created");
}

const programs = new ProgramService(new PostgresProgramStore(pool), ledger);
const anchorer = process.env.ETH_RPC_URL
  ? new EthereumRpcAnchorer({ rpcUrl: process.env.ETH_RPC_URL, from: process.env.ETH_ANCHOR_FROM ?? "", network: process.env.ETH_NETWORK ?? "ethereum" })
  : new LocalAnchorer(); // no external proof until ETH_RPC_URL is configured
const anchors = new AnchorService(ledger, new PostgresAnchorStore(pool), anchorer);
const anchorEveryMs = Number(process.env.ANCHOR_INTERVAL_MS ?? 0);
const metrics = new Metrics();
const alert = makeAlerter((l) => console.log(l), process.env.ALERT_WEBHOOK_URL);
const onAnchorFailure = () => {
  metrics.inc("anchor_failures");
  alert("high", "ledger anchoring failed");
};
startHealthSchedule(
  { ping: async () => void (await pool.query("SELECT 1")), verifyLedger: () => ledger.verify() },
  metrics, alert, Number(process.env.HEALTH_INTERVAL_MS ?? 60_000),
);
if (anchorEveryMs >= 60_000) startAnchorSchedule(anchors, anchorEveryMs, (l) => console.log(l), onAnchorFailure);
else if (process.env.ANCHOR_INTERVAL_MS && anchorEveryMs !== 0) throw new Error("ANCHOR_INTERVAL_MS must be 0 (off) or at least 60000");

const app = await buildApp({
  programs,
  anchors,
  metrics,
  onAnchorFailure,
  cases: new CaseService(ledger, new PostgresCaseStore(pool), Buffer.from(piiKeyHex, "hex"), rules, poverty, programs),
  jwtSecret: secret,
  users,
  ledger,
  requireMfa: true,
  log: (l) => console.log(l),
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
