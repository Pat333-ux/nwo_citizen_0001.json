import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import argon2 from "argon2";
import { authorize, type Permission, type Role } from "../auth/rbac.ts";
import { auditEvent } from "../audit/audit.ts";
import type { LedgerService } from "../ledger/store.ts";

export interface UserRecord {
  username: string;
  passwordHash: string; // Argon2
  role: Role;
}

export interface AppOptions {
  jwtSecret: string;
  users: Map<string, UserRecord>;
  ledger: LedgerService;
  log?: (line: string) => void;
}

export const hashPassword = (pw: string): Promise<string> => argon2.hash(pw, { type: argon2.argon2id });

interface TokenPayload {
  sub: string;
  role: Role;
}

/** Identity (single JWT issuer) and Ledger API in one deployable. Ledger writes only happen via LedgerService. */
export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  if (opts.jwtSecret.length < 32) throw new Error("JWT secret must be at least 32 characters");
  const log = opts.log ?? (() => {});
  const app = Fastify({ logger: false });
  await app.register(helmet);
  await app.register(jwt, { secret: opts.jwtSecret, sign: { expiresIn: "15m" } });

  // Fixed hash so unknown usernames cost the same time as wrong passwords.
  const dummyHash = await hashPassword("not-a-real-password");

  app.post<{ Body: { username?: string; password?: string } }>(
    "/v1/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: { username: { type: "string", maxLength: 128 }, password: { type: "string", maxLength: 256 } },
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string };
      const user = opts.users.get(username);
      const ok = await argon2.verify(user?.passwordHash ?? dummyHash, password).catch(() => false);
      if (!user || !ok) {
        auditEvent({ actor: "anonymous", action: "auth.login", outcome: "failure" }, log);
        return reply.code(401).send({ error: "Invalid credentials" });
      }
      auditEvent({ actor: user.username, action: "auth.login", outcome: "success" }, log);
      const payload: TokenPayload = { sub: user.username, role: user.role };
      return { token: app.jwt.sign(payload) };
    },
  );

  const guard =
    (permission: Permission) =>
    async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
      try {
        await req.jwtVerify();
        const { role, sub } = req.user as TokenPayload;
        authorize(role, permission);
        auditEvent({ actor: sub, action: permission, outcome: "success" }, log);
      } catch {
        auditEvent({ actor: "unknown", action: permission, outcome: "failure" }, log);
        return reply.code(403).send({ error: "Forbidden" });
      }
    };

  app.get("/v1/ledger/records", { preHandler: guard("ledger:read") }, async () => opts.ledger.list());
  app.get("/v1/ledger/verify", { preHandler: guard("ledger:read") }, async () => opts.ledger.verify());

  app.post<{ Body: { action: string; payload?: unknown } }>(
    "/v1/ledger/events",
    {
      preHandler: guard("case:review"),
      schema: {
        body: {
          type: "object",
          required: ["action"],
          properties: { action: { type: "string", maxLength: 128 }, payload: {} },
        },
      },
    },
    async (req, reply) => {
      const { sub } = req.user as TokenPayload;
      const rec = await opts.ledger.append(sub, req.body.action, req.body.payload);
      return reply.code(201).send(rec);
    },
  );

  app.get("/healthz", async () => ({ ok: true }));
  return app;
}
