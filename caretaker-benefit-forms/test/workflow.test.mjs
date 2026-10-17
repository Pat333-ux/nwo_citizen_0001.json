import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { BenefitWorkflowManager, createWebhookServer } from "../workflow_engine.mjs";

const base = JSON.parse(fs.readFileSync(new URL("../example_payload.json", import.meta.url), "utf8"));
function tmpPayload(extra = {}) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wf-")), "p.json");
  fs.writeFileSync(f, JSON.stringify({ ...base, ...extra }));
  return f;
}
const quiet = { log: () => {} };

test("pause, partial approval, then full approval", () => {
  const f = tmpPayload({ workflow_state: "FORMS_GENERATED" });
  const m = new BenefitWorkflowManager(f, quiet);
  m.submitToGovernmentAgencies();
  assert.equal(m.state, "PAUSED_AWAITING_GOVERNMENT_VERIFICATION");
  m.receiveGovernmentResponse("INDIANA_OECOSL", "APPROVED", "R1");
  assert.equal(m.state, "PAUSED_AWAITING_GOVERNMENT_VERIFICATION");
  m.receiveGovernmentResponse("INDIANA_BRS", "APPROVED", "R2");
  assert.equal(m.state, "VERIFIED_APPROVED");
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).compliance_tracking.ic_code_compliance_status, "COMPLIANT");
});

test("denial requires action; responses rejected when not awaiting", () => {
  const m = new BenefitWorkflowManager(tmpPayload({ workflow_state: "FORMS_GENERATED" }), quiet);
  assert.throws(() => m.receiveGovernmentResponse("A", "APPROVED", "x"));
  m.submitToGovernmentAgencies();
  m.receiveGovernmentResponse("INDIANA_BRS", "DENIED", "x");
  assert.equal(m.state, "ACTION_REQUIRED_DEFICIENCY");
  assert.throws(() => m.receiveGovernmentResponse("A", "BOGUS", "x"));
});

test("illegal transitions rejected", () => {
  const m = new BenefitWorkflowManager(tmpPayload({ workflow_state: "DRAFT" }), quiet);
  assert.throws(() => m.submitToGovernmentAgencies());
});

test("audit expires approved authorization", () => {
  const m = new BenefitWorkflowManager(tmpPayload({ workflow_state: "FORMS_GENERATED" }), quiet);
  m.submitToGovernmentAgencies();
  m.receiveGovernmentResponse("INDIANA_OECOSL", "APPROVED", "1");
  m.receiveGovernmentResponse("INDIANA_BRS", "APPROVED", "2");
  assert.equal(m.runComplianceAudit(), true);
  assert.equal(m.runComplianceAudit(new Date("2100-01-01")), false);
  assert.equal(m.state, "EXPIRED_RENEWAL_REQUIRED");
});

test("webhook requires valid signature", async () => {
  const f = tmpPayload({ workflow_state: "FORMS_GENERATED" });
  new BenefitWorkflowManager(f, quiet).submitToGovernmentAgencies();
  const srv = createWebhookServer(f, "s3cret");
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}/webhook/government-response`;
  const body = JSON.stringify({ agency: "INDIANA_BRS", status: "MORE_INFO_NEEDED", reference_id: "z" });
  const sig = crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  let r = await fetch(url, { method: "POST", body, headers: { "x-signature": "00" } });
  assert.equal(r.status, 401);
  r = await fetch(url, { method: "POST", body, headers: { "x-signature": sig } });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).workflow_state, "ACTION_REQUIRED_DEFICIENCY");
  srv.close();
});
