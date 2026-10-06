import type { SignedPacket } from "../types.ts";
import { programs } from "../engine.ts";
import { agencyForProgram } from "./agencies.ts";
import { log } from "./log.ts";

export type SubmissionStatus = "pending-approval" | "approved" | "submitted" | "approved-by-agency" | "denied" | "pending-agency" | "rejected-by-member";

export interface Submission {
  envelopeId: string;
  agencyId: string;
  packet: SignedPacket;
  status: SubmissionStatus;
  history: { status: SubmissionStatus; at: string }[];
}

export type Submitter = (submission: Submission) => Promise<void>;

const store = new Map<string, Submission>();

function setStatus(s: Submission, status: SubmissionStatus, at: string) {
  s.status = status;
  s.history.push({ status, at });
  log("submission.status", { envelopeId: s.envelopeId, agencyId: s.agencyId, status });
}

export function queueForAgency(packet: SignedPacket, at: string = new Date().toISOString()): Submission {
  const program = programs.find(p => p.id === packet.programId);
  if (!program) throw new Error(`Unknown program ${packet.programId}`);
  const agency = agencyForProgram(program);
  const s: Submission = {
    envelopeId: `${packet.programId}-${packet.memberId}`,
    agencyId: agency.agencyId,
    packet,
    status: "pending-approval",
    history: [{ status: "pending-approval", at }]
  };
  store.set(s.envelopeId, s);
  log("submission.queued", { envelopeId: s.envelopeId, agencyId: s.agencyId });
  return s;
}

export function approve(envelopeId: string, at: string = new Date().toISOString()): Submission {
  const s = get(envelopeId);
  if (s.status !== "pending-approval") throw new Error(`Cannot approve from ${s.status}`);
  setStatus(s, "approved", at);
  return s;
}

export function reject(envelopeId: string, at: string = new Date().toISOString()): Submission {
  const s = get(envelopeId);
  if (s.status !== "pending-approval") throw new Error(`Cannot reject from ${s.status}`);
  setStatus(s, "rejected-by-member", at);
  return s;
}

// Human approval is mandatory. The submitter is an injected agency-specific
// transport; this repo ships none, so no application is sent anywhere by default.
export async function submit(envelopeId: string, submitter: Submitter, at: string = new Date().toISOString()): Promise<Submission> {
  const s = get(envelopeId);
  if (s.status !== "approved") throw new Error(`Submission ${envelopeId} not approved (status: ${s.status})`);
  await submitter(s);
  setStatus(s, "submitted", at);
  return s;
}

export function recordOutcome(envelopeId: string, outcome: "approved-by-agency" | "denied" | "pending-agency", at: string = new Date().toISOString()): Submission {
  const s = get(envelopeId);
  if (s.status !== "submitted" && s.status !== "pending-agency") throw new Error(`Cannot record outcome from ${s.status}`);
  setStatus(s, outcome, at);
  return s;
}

export function get(envelopeId: string): Submission {
  const s = store.get(envelopeId);
  if (!s) throw new Error(`Unknown submission ${envelopeId}`);
  return s;
}

export function listByAgency(agencyId: string): Submission[] {
  return [...store.values()].filter(s => s.agencyId === agencyId);
}

export function clearSubmissions(): void { store.clear(); }

export function listAll(): Submission[] { return [...store.values()]; }
