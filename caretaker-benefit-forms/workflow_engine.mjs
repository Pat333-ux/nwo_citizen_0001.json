import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const STATES = [
  "DRAFT", "FORMS_GENERATED", "PENDING_GOVERNMENT_SUBMISSION",
  "PAUSED_AWAITING_GOVERNMENT_VERIFICATION", "VERIFIED_APPROVED",
  "ACTION_REQUIRED_DEFICIENCY", "EXPIRED_RENEWAL_REQUIRED",
];
const RESPONSE_STATUSES = ["RECEIVED", "UNDER_REVIEW", "APPROVED", "DENIED", "MORE_INFO_NEEDED"];

const TRANSITIONS = {
  DRAFT: ["FORMS_GENERATED"],
  FORMS_GENERATED: ["PENDING_GOVERNMENT_SUBMISSION", "PAUSED_AWAITING_GOVERNMENT_VERIFICATION"],
  PENDING_GOVERNMENT_SUBMISSION: ["PAUSED_AWAITING_GOVERNMENT_VERIFICATION"],
  PAUSED_AWAITING_GOVERNMENT_VERIFICATION: ["VERIFIED_APPROVED", "ACTION_REQUIRED_DEFICIENCY"],
  ACTION_REQUIRED_DEFICIENCY: ["PAUSED_AWAITING_GOVERNMENT_VERIFICATION"],
  VERIFIED_APPROVED: ["EXPIRED_RENEWAL_REQUIRED"],
  EXPIRED_RENEWAL_REQUIRED: ["PAUSED_AWAITING_GOVERNMENT_VERIFICATION"],
};

// Which agency identifiers must approve for each authorized scope.
export const SCOPE_AGENCIES = {
  INDIANA_FSSA_MEDICAID: "INDIANA_FSSA_DFR",
  INDIANA_DFR_SNAP_TANF: "INDIANA_FSSA_DFR",
  HUD_HOUSING_ASSISTANCE: "HUD_IHCDA",
  INDIANA_EAP_LIHEAP: "INDIANA_EAP",
  INDIANA_CCDF_CHILDCARE: "INDIANA_OECOSL",
  INDIANA_VOCATIONAL_REHAB: "INDIANA_BRS",
};

export class BenefitWorkflowManager {
  constructor(payloadPath, { log = console.log } = {}) {
    this.payloadPath = payloadPath;
    this.log = log;
    this.payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    this.payload.workflow_state ??= "DRAFT";
  }

  get state() { return this.payload.workflow_state; }

  saveState() {
    const tmp = `${this.payloadPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.payload, null, 2));
    fs.renameSync(tmp, this.payloadPath);
    this.log(`[WORKFLOW] State: ${this.state}`);
  }

  transition(to) {
    if (this.state === to) return;
    if (!(TRANSITIONS[this.state] ?? []).includes(to)) {
      throw new Error(`Illegal transition ${this.state} -> ${to}`);
    }
    this.payload.workflow_state = to;
  }

  markFormsGenerated() {
    this.transition("FORMS_GENERATED");
    this.saveState();
  }

  expectedAgencies() {
    return [...new Set((this.payload.authorized_scopes ?? []).map((s) => SCOPE_AGENCIES[s]).filter(Boolean))];
  }

  // Submit forms and pause until government verification arrives.
  submitToGovernmentAgencies(now = new Date()) {
    this.transition("PAUSED_AWAITING_GOVERNMENT_VERIFICATION");
    const due = new Date(now);
    due.setUTCFullYear(due.getUTCFullYear() + 1);
    this.payload.compliance_tracking = {
      last_audit_timestamp: now.toISOString(),
      ic_code_compliance_status: "AUDIT_PENDING",
      annual_re_certification_due: due.toISOString().slice(0, 10),
    };
    this.payload.government_responses = [];
    this.saveState();
    this.log("[WORKFLOW] PAUSED awaiting agency responses.");
  }

  // Latest status per agency.
  agencyStatuses() {
    const latest = {};
    for (const r of this.payload.government_responses ?? []) latest[r.agency] = r.status;
    return latest;
  }

  receiveGovernmentResponse(agency, status, referenceId, notes = "", now = new Date()) {
    if (!RESPONSE_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
    if (!agency) throw new Error("agency required");
    if (this.state !== "PAUSED_AWAITING_GOVERNMENT_VERIFICATION") {
      throw new Error(`Not awaiting verification (state ${this.state})`);
    }
    (this.payload.government_responses ??= []).push({
      agency, status, reference_id: referenceId,
      response_timestamp: now.toISOString(), notes,
    });
    const ct = (this.payload.compliance_tracking ??= {});

    if (status === "DENIED" || status === "MORE_INFO_NEEDED") {
      this.transition("ACTION_REQUIRED_DEFICIENCY");
      ct.ic_code_compliance_status = "NON_COMPLIANT";
      this.log(`[ACTION REQUIRED] ${agency}: ${status}. Human intervention needed.`);
    } else if (status === "APPROVED") {
      const latest = this.agencyStatuses();
      const all = this.expectedAgencies().every((a) => latest[a] === "APPROVED");
      if (all) {
        this.transition("VERIFIED_APPROVED");
        ct.ic_code_compliance_status = "COMPLIANT";
        this.log("[SUCCESS] All agencies approved. Resuming workflow.");
      } else {
        this.log(`[WORKFLOW] ${agency} approved; waiting on remaining agencies.`);
      }
    }
    this.saveState();
  }

  // Periodic audit; returns true if compliant.
  runComplianceAudit(now = new Date()) {
    const ct = this.payload.compliance_tracking;
    const today = now.toISOString().slice(0, 10);
    if (!ct?.annual_re_certification_due) {
      this.log("[COMPLIANCE] No recertification date; nothing submitted yet.");
      return false;
    }
    ct.last_audit_timestamp = now.toISOString();
    if (ct.annual_re_certification_due <= today && this.state === "VERIFIED_APPROVED") {
      this.transition("EXPIRED_RENEWAL_REQUIRED");
      ct.ic_code_compliance_status = "NON_COMPLIANT";
      this.log("[COMPLIANCE WARNING] Authorization expired; recertification required.");
      this.saveState();
      return false;
    }
    this.saveState();
    return this.state === "VERIFIED_APPROVED" && ct.ic_code_compliance_status === "COMPLIANT";
  }
}

// Webhook listener: POST /webhook/government-response with JSON
// {agency,status,reference_id,notes}. Requires HMAC-SHA256 of the raw body in
// the X-Signature header (hex), keyed by the shared secret.
export function createWebhookServer(payloadPath, secret, { maxBytes = 64 * 1024, log = () => {} } = {}) {
  if (!secret) throw new Error("webhook secret required");
  return http.createServer((req, res) => {
    const reply = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method !== "POST" || req.url !== "/webhook/government-response") return reply(404, { error: "not found" });
    const chunks = []; let size = 0; let aborted = false;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) { aborted = true; reply(413, { error: "too large" }); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks);
      const sig = Buffer.from(String(req.headers["x-signature"] ?? ""), "hex");
      const want = crypto.createHmac("sha256", secret).update(raw).digest();
      if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return reply(401, { error: "bad signature" });
      try {
        const b = JSON.parse(raw.toString("utf8"));
        const m = new BenefitWorkflowManager(payloadPath, { log });
        m.receiveGovernmentResponse(b.agency, b.status, b.reference_id, b.notes ?? "");
        reply(200, { state: m.state });
      } catch (e) {
        reply(400, { error: e.message });
      }
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [payloadPath, port = "8787"] = process.argv.slice(2);
  const secret = process.env.WEBHOOK_SECRET;
  if (!payloadPath || !secret) { console.error("usage: WEBHOOK_SECRET=... node workflow_engine.mjs payload.json [port]"); process.exit(2); }
  createWebhookServer(payloadPath, secret, { log: console.log }).listen(Number(port), () => console.log(`listening on ${port}`));
}
