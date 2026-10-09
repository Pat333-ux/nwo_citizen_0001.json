import { buildApp, hashPassword, type UserRecord } from "./app.ts";
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

const app = await buildApp({
  jwtSecret: secret,
  users,
  ledger: new LedgerService(PostgresLedgerStore.fromEnv()),
  log: (l) => console.log(l),
});
await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
