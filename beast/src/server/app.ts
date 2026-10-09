import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import argon2 from "argon2";
import { authorize, type Permission, type Role } from "../auth/rbac.ts";
import { auditEvent } from "../audit/audit.ts";
import type { LedgerService } from "../ledger/store.ts";
import { CaseService, ConflictError, NotFoundError, type NewApplication, type NewIdentity } from "./cases.ts";

export interface UserRecord {
  username: string;
  passwordHash: string; // Argon2
  role: Role;
}

export interface AppOptions {
  jwtSecret: string;
  users: Map<string, UserRecord>;
  ledger: LedgerService;
  cases?: CaseService;
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

  const cases = opts.cases;
  if (cases) {
    app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
      if (err instanceof NotFoundError) return reply.code(404).send({ error: "Not found" });
      if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
      if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
      return reply.code(500).send({ error: "Internal error" });
    });
    const actor = (req: FastifyRequest) => (req.user as TokenPayload).sub;
    const idBody = {
      type: "object", required: ["type", "jurisdiction", "name", "address", "email"], additionalProperties: false,
      properties: {
        type: { enum: ["citizen", "business", "government", "dao"] },
        jurisdiction: { type: "string", maxLength: 64 },
        name: { type: "string", maxLength: 256 }, address: { type: "string", maxLength: 512 },
        email: { type: "string", maxLength: 256 },
      },
    };
    const appBody = {
      type: "object", additionalProperties: false,
      required: ["identityId", "adults", "children", "monthlyIncome", "veteranStatus", "disabilityStatus", "housingStatus"],
      properties: {
        identityId: { type: "string" }, adults: { type: "integer", minimum: 0, maximum: 50 },
        children: { type: "integer", minimum: 0, maximum: 50 }, monthlyIncome: { type: "number", minimum: 0 },
        veteranStatus: { type: "boolean" }, disabilityStatus: { type: "boolean" },
        housingStatus: { type: "string", maxLength: 64 },
      },
    };
    const idParam = { type: "object", properties: { id: { type: "string", maxLength: 64 } } };
    type P = { Params: { id: string } };

    app.post<{ Body: NewIdentity }>("/v1/identities", { preHandler: guard("case:create"), schema: { body: idBody } },
      async (req, reply) => reply.code(201).send(await cases.createIdentity(actor(req), req.body)));
    app.post<P>("/v1/identities/:id/verify", { preHandler: guard("case:review"), schema: { params: idParam } },
      async (req) => cases.verifyIdentity(actor(req), req.params.id));
    app.post<{ Body: NewApplication }>("/v1/applications", { preHandler: guard("case:create"), schema: { body: appBody } },
      async (req, reply) => reply.code(201).send(await cases.createApplication(actor(req), req.body)));
    app.post<P>("/v1/applications/:id/submit", { preHandler: guard("case:create"), schema: { params: idParam } },
      async (req) => cases.transition(actor(req), req.params.id, "submitted"));
    app.post<P>("/v1/applications/:id/start-review", { preHandler: guard("case:review"), schema: { params: idParam } },
      async (req) => cases.transition(actor(req), req.params.id, "in_review"));
    app.post<P & { Body: { decision: "approved" | "denied" } }>("/v1/applications/:id/decision", {
      preHandler: guard("case:decide"),
      schema: { params: idParam, body: { type: "object", required: ["decision"], additionalProperties: false, properties: { decision: { enum: ["approved", "denied"] } } } },
    }, async (req) => cases.transition(actor(req), req.params.id, req.body.decision));
    app.post<P>("/v1/applications/:id/appeal", { preHandler: guard("case:create"), schema: { params: idParam } },
      async (req) => cases.transition(actor(req), req.params.id, "appealed"));
    app.get<P>("/v1/applications/:id/recommendations", { preHandler: guard("case:read"), schema: { params: idParam } },
      async (req) => cases.recommendations(req.params.id));
    app.get("/v1/kpis", { preHandler: guard("kpi:read") }, async () => cases.kpis());
    app.get("/v1/ledger/root", { preHandler: guard("ledger:read") }, async () => cases.ledgerRoot());
  }

  app.get("/healthz", async () => ({ ok: true }));
  return app;
}
