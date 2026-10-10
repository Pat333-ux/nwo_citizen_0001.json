import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import { authorize, type Permission, type Role } from "../auth/rbac.ts";
import { MIN_PASSWORD_LENGTH, hashPassword, type UserService } from "./users.ts";
import { auditEvent } from "../audit/audit.ts";
import type { LedgerService } from "../ledger/store.ts";
import { CaseService, ConflictError, NotFoundError, type NewApplication, type NewIdentity } from "./cases.ts";

export interface AppOptions {
  jwtSecret: string;
  users: UserService;
  ledger: LedgerService;
  cases?: CaseService;
  log?: (line: string) => void;
}

export { hashPassword };

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

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof NotFoundError) return reply.code(404).send({ error: "Not found" });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    return reply.code(500).send({ error: "Internal error" });
  });

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
      const user = await opts.users.authenticate(username, password);
      if (!user) {
        auditEvent({ actor: "anonymous", action: "auth.login", outcome: "failure" }, log);
        return reply.code(401).send({ error: "Invalid credentials" });
      }
      auditEvent({ actor: user.username, action: "auth.login", outcome: "success" }, log);
      const payload: TokenPayload = { sub: user.username, role: user.role };
      return { token: app.jwt.sign(payload) };
    },
  );

  // Role is read from the user store on every request, so disabling an account
  // or changing a role takes effect immediately, even for unexpired tokens.
  const guard =
    (permission: Permission | null) =>
    async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
      try {
        await req.jwtVerify();
        const { sub } = req.user as TokenPayload;
        const user = await opts.users.store.findByUsername(sub);
        if (!user || !user.active) throw new Error("inactive");
        if (permission) authorize(user.role, permission);
        auditEvent({ actor: sub, action: permission ?? "authenticated", outcome: "success" }, log);
      } catch {
        auditEvent({ actor: "unknown", action: permission ?? "authenticated", outcome: "failure" }, log);
        return reply.code(403).send({ error: "Forbidden" });
      }
    };

  const pw = { type: "string", minLength: MIN_PASSWORD_LENGTH, maxLength: 256 };
  const userParam = { type: "object", properties: { id: { type: "string", maxLength: 64 } } };
  type UP = { Params: { id: string } };
  const self = (req: FastifyRequest) => (req.user as TokenPayload).sub;

  app.post<{ Body: { username: string; password: string; role: Role } }>("/v1/users", {
    preHandler: guard("user:manage"),
    schema: { body: { type: "object", required: ["username", "password", "role"], additionalProperties: false, properties: {
      username: { type: "string", pattern: "^[a-z0-9._-]{3,64}$" }, password: pw, role: { enum: ["caseworker", "admin", "auditor"] } } } },
  }, async (req, reply) => reply.code(201).send(await opts.users.create(self(req), req.body)));
  app.get("/v1/users", { preHandler: guard("user:manage") }, async () => opts.users.list());
  app.post<UP>("/v1/users/:id/disable", { preHandler: guard("user:manage"), schema: { params: userParam } },
    async (req) => opts.users.setActive(self(req), req.params.id, false));
  app.post<UP>("/v1/users/:id/enable", { preHandler: guard("user:manage"), schema: { params: userParam } },
    async (req) => opts.users.setActive(self(req), req.params.id, true));
  app.post<UP & { Body: { password: string } }>("/v1/users/:id/password", {
    preHandler: guard("user:manage"),
    schema: { params: userParam, body: { type: "object", required: ["password"], additionalProperties: false, properties: { password: pw } } },
  }, async (req, reply) => {
    await opts.users.resetPassword(self(req), req.params.id, req.body.password);
    return reply.code(204).send();
  });
  app.post<{ Body: { currentPassword: string; newPassword: string } }>("/v1/auth/password", {
    preHandler: guard(null),
    schema: { body: { type: "object", required: ["currentPassword", "newPassword"], additionalProperties: false, properties: { currentPassword: { type: "string", maxLength: 256 }, newPassword: pw } } },
  }, async (req, reply) => {
    const ok = await opts.users.changeOwnPassword(self(req), req.body.currentPassword, req.body.newPassword);
    return ok ? reply.code(204).send() : reply.code(401).send({ error: "Invalid credentials" });
  });

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
