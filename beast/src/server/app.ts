import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import { authorize, type Permission, type Role } from "../auth/rbac.ts";
import { LoginThrottle } from "../auth/throttle.ts";
import { MIN_PASSWORD_LENGTH, hashPassword, type UserService } from "./users.ts";
import { auditEvent } from "../audit/audit.ts";
import type { LedgerService } from "../ledger/store.ts";
import type { AnchorService } from "../anchor/anchor.ts";
import type { ProgramService } from "./programs.ts";
import { CaseService, ConflictError, NotFoundError, type NewApplication, type NewIdentity } from "./cases.ts";

export interface AppOptions {
  jwtSecret: string;
  users: UserService;
  ledger: LedgerService;
  cases?: CaseService;
  programs?: ProgramService;
  anchors?: AnchorService;
  log?: (line: string) => void;
  throttle?: LoginThrottle;
  /** When true, every account must enroll TOTP MFA; until then its token only reaches /v1/auth/mfa/*. */
  requireMfa?: boolean;
}

export { hashPassword };

interface TokenPayload {
  sub: string;
  role: Role;
  mfa: boolean;
}

/** Identity (single JWT issuer) and Ledger API in one deployable. There is no HTTP route that writes arbitrary ledger entries; writes happen only inside services. */
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

  const throttle = opts.throttle ?? new LoginThrottle();

  app.post<{ Body: { username?: string; password?: string } }>(
    "/v1/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          properties: { username: { type: "string", maxLength: 128 }, password: { type: "string", maxLength: 256 }, otp: { type: "string", maxLength: 16 } },
        },
      },
    },
    async (req, reply) => {
      const { username, password, otp } = req.body as { username: string; password: string; otp?: string };
      const keys = [`u:${username}`, `ip:${req.ip}`];
      if (keys.some((k) => throttle.isLocked(k))) {
        auditEvent({ actor: "anonymous", action: "auth.login.locked", outcome: "failure" }, log);
        return reply.code(429).send({ error: "Too many attempts. Try again later." });
      }
      const user = await opts.users.authenticate(username, password);
      if (!user) {
        keys.forEach((k) => throttle.recordFailure(k));
        auditEvent({ actor: "anonymous", action: "auth.login", outcome: "failure" }, log);
        return reply.code(401).send({ error: "Invalid credentials" });
      }
      if (user.mfaEnabled && !(await opts.users.checkMfaCode(user, otp))) {
        keys.forEach((k) => throttle.recordFailure(k));
        auditEvent({ actor: user.username, action: "auth.login.mfa", outcome: "failure" }, log);
        return reply.code(401).send({ error: "Invalid credentials or MFA code" });
      }
      throttle.recordSuccess(`u:${username}`);
      auditEvent({ actor: user.username, action: "auth.login", outcome: "success" }, log);
      const mfa = user.mfaEnabled || !opts.requireMfa;
      const payload: TokenPayload = { sub: user.username, role: user.role, mfa };
      return { token: app.jwt.sign(payload) };
    },
  );

  // Role is read from the user store on every request, so disabling an account
  // or changing a role takes effect immediately, even for unexpired tokens.
  const guard =
    (permission: Permission | null, allowPendingMfa = false) =>
    async (req: FastifyRequest, reply: import("fastify").FastifyReply) => {
      try {
        await req.jwtVerify();
        const { sub, mfa } = req.user as TokenPayload;
        const user = await opts.users.store.findByUsername(sub);
        if (!user || !user.active) throw new Error("inactive");
        if (opts.requireMfa && !allowPendingMfa && !(mfa && user.mfaEnabled)) throw new Error("mfa required");
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

  app.post("/v1/auth/mfa/enroll", { preHandler: guard(null, true) }, async (req) => opts.users.beginMfaEnrollment(self(req)));
  app.post<{ Body: { code: string } }>("/v1/auth/mfa/confirm", {
    preHandler: guard(null, true),
    schema: { body: { type: "object", required: ["code"], additionalProperties: false, properties: { code: { type: "string", maxLength: 16 } } } },
  }, async (req, reply) => {
    const ok = await opts.users.confirmMfa(self(req), req.body.code);
    return ok ? reply.code(204).send() : reply.code(401).send({ error: "Invalid code" });
  });
  app.post<UP>("/v1/users/:id/mfa/reset", { preHandler: guard("user:manage"), schema: { params: userParam } }, async (req, reply) => {
    await opts.users.resetMfa(self(req), req.params.id);
    return reply.code(204).send();
  });

  app.get("/v1/ledger/records", { preHandler: guard("ledger:read") }, async () => opts.ledger.list());
  app.get("/v1/ledger/verify", { preHandler: guard("ledger:read") }, async () => opts.ledger.verify());

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
        identityId: { type: "string" }, programId: { type: "string", pattern: "^[a-z0-9-]{2,64}$" }, adults: { type: "integer", minimum: 0, maximum: 50 },
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
    app.get("/v1/dashboard/summary", { preHandler: guard("kpi:read") }, async () => {
      const k = await cases.kpis();
      const [u, v, recs] = await Promise.all([opts.users.stats(), opts.ledger.verify(), opts.ledger.list()]);
      const last = await opts.anchors?.latest();
      // Aggregates only: counts, percentages and status flags. No identifiers, names or per-person data.
      return {
        applications: Object.values(k.byProgram).reduce((a, p) => a + p.applications, 0),
        approvals: k.approvals, denials: k.denials, appeals: k.appeals, pending: k.applicationsPending,
        activeUsers: u.activeUsers, activeFamilies: k.familiesServed,
        ledgerHealth: { valid: v.valid, records: recs.length },
        mfaCompliance: { enrolled: u.mfaEnrolled, activeUsers: u.activeUsers, percent: u.mfaCompliancePercent },
        lastAnchor: last ? { anchoredAt: last.anchoredAt, network: last.network, records: last.records } : null,
        byProgram: k.byProgram,
      };
    });
    app.get("/v1/ledger/root", { preHandler: guard("ledger:read") }, async () => cases.ledgerRoot());
  }

  const programs = opts.programs;
  if (programs) {
    app.get("/v1/programs", { preHandler: guard("program:read") }, async () => programs.list());
    app.post<{ Body: { id: string; name: string; description?: string; ruleSet?: string | null } }>("/v1/programs", {
      preHandler: guard("config:write"),
      schema: { body: { type: "object", required: ["id", "name"], additionalProperties: false, properties: {
        id: { type: "string", pattern: "^[a-z0-9-]{2,64}$" }, name: { type: "string", minLength: 1, maxLength: 128 },
        description: { type: "string", maxLength: 1024 }, ruleSet: { type: ["string", "null"], maxLength: 64 } } } },
    }, async (req, reply) => reply.code(201).send(await programs.create(self(req), req.body)));
    app.post<UP>("/v1/programs/:id/disable", { preHandler: guard("config:write"), schema: { params: userParam } },
      async (req) => programs.setActive(self(req), req.params.id, false));
    app.post<UP>("/v1/programs/:id/enable", { preHandler: guard("config:write"), schema: { params: userParam } },
      async (req) => programs.setActive(self(req), req.params.id, true));
  }

  const anchors = opts.anchors;
  if (anchors) {
    app.get("/v1/anchors", { preHandler: guard("ledger:read") }, async () => anchors.list());
    app.post("/v1/anchors", { preHandler: guard("ledger:anchor") }, async (req, reply) => {
      try {
        const r = await anchors.anchorNow(self(req));
        return reply.code(r.anchored ? 201 : 200).send(r);
      } catch {
        auditEvent({ actor: self(req), action: "ledger.anchor", outcome: "failure" }, log);
        return reply.code(502).send({ error: "Anchoring failed; see server logs" });
      }
    });
  }

  // Read-only aggregate dashboard. The page holds no data; it calls /v1/kpis with a user token.
  app.get("/dashboard", async (_req, reply) => reply.type("text/html; charset=utf-8").send(DASHBOARD_HTML));
  app.get("/dashboard/app.js", async (_req, reply) => reply.type("application/javascript; charset=utf-8").send(DASHBOARD_JS));

  app.get("/healthz", async () => ({ ok: true }));
  return app;
}

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BEAST Dashboard</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem auto;max-width:42rem;padding:0 1rem;color:#111;background:#fff}
label{display:block;margin-top:.75rem;font-weight:600}
input,button{font:inherit;padding:.5rem;margin-top:.25rem}
button{background:#0b57d0;color:#fff;border:0;border-radius:4px;cursor:pointer}
button:focus,input:focus{outline:3px solid #ffbf47;outline-offset:2px}
table{border-collapse:collapse;width:100%;margin-top:1rem}
th,td{border:1px solid #444;padding:.5rem;text-align:left}
[role=alert]{color:#a40000;font-weight:600}
</style>
</head>
<body>
<main>
<h1>BEAST Dashboard</h1>
<p>Aggregate, read-only figures. No personal data is shown.</p>
<form id="login">
<label for="u">Username</label><input id="u" autocomplete="username" required>
<label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required>
<label for="o">Authenticator code</label><input id="o" inputmode="numeric" autocomplete="one-time-code" maxlength="6">
<div><button type="submit">Sign in</button></div>
</form>
<p id="msg" role="alert" aria-live="polite"></p>
<section id="kpis" hidden>
<h2>Key figures</h2>
<table><caption>Program counts</caption><thead><tr><th scope="col">Measure</th><th scope="col">Count</th></tr></thead><tbody id="rows"></tbody></table>
<table><caption>By program</caption><thead><tr><th scope="col">Program</th><th scope="col">Applications</th><th scope="col">Approvals</th><th scope="col">Denials</th><th scope="col">Appeals</th><th scope="col">Pending</th></tr></thead><tbody id="prog"></tbody></table>
<p><button id="out" type="button">Sign out</button></p>
</section>
</main>
<script src="/dashboard/app.js"></script>
</body>
</html>`;

const DASHBOARD_JS = `(function(){
var token=null;
var labels={applications:"Applications",approvals:"Approvals",denials:"Denials",appeals:"Appeals",pending:"Pending review",activeUsers:"Active users",activeFamilies:"Active families"};
function $(id){return document.getElementById(id);}
function msg(t){$("msg").textContent=t||"";}
async function load(){
  var r=await fetch("/v1/dashboard/summary",{headers:{authorization:"Bearer"+" "+token}});
  if(!r.ok){msg("Not allowed to view figures.");return;}
  var d=await r.json();var rows=$("rows");rows.textContent="";
  Object.keys(labels).forEach(function(k){
    var tr=document.createElement("tr"),a=document.createElement("th"),b=document.createElement("td");
    a.scope="row";a.textContent=labels[k];b.textContent=String(d[k]);tr.appendChild(a);tr.appendChild(b);rows.appendChild(tr);
  });
  [["Ledger health",(d.ledgerHealth.valid?"Valid":"BROKEN")+" ("+d.ledgerHealth.records+" records)"],["MFA compliance",d.mfaCompliance.percent+"% ("+d.mfaCompliance.enrolled+" of "+d.mfaCompliance.activeUsers+")"],["Last ledger anchor",d.lastAnchor?d.lastAnchor.anchoredAt+" ("+d.lastAnchor.network+")":"None"]].forEach(function(x){
    var tr=document.createElement("tr"),a=document.createElement("th"),b=document.createElement("td");
    a.scope="row";a.textContent=x[0];b.textContent=x[1];tr.appendChild(a);tr.appendChild(b);rows.appendChild(tr);
  });
  var pr=$("prog");pr.textContent="";
  Object.keys(d.byProgram).forEach(function(id){
    var p=d.byProgram[id],tr=document.createElement("tr");
    [id,p.applications,p.approvals,p.denials,p.appeals,p.pending].forEach(function(v,i){var c=document.createElement(i?"td":"th");if(!i)c.scope="row";c.textContent=String(v);tr.appendChild(c);});
    pr.appendChild(tr);
  });
  $("kpis").hidden=false;$("login").hidden=true;msg("");
}
$("login").addEventListener("submit",async function(e){
  e.preventDefault();msg("");
  var r=await fetch("/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:$("u").value,password:$("p").value,otp:$("o").value||undefined})});
  if(r.status===429){msg("Too many attempts. Try again later.");return;}
  if(!r.ok){msg("Sign-in failed.");return;}
  token=(await r.json()).token;$("p").value="";await load();
});
$("out").addEventListener("click",function(){token=null;$("kpis").hidden=true;$("login").hidden=false;});
})();`;
