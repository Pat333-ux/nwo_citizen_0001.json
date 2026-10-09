export interface AuditEvent {
  time: string;
  actor: string;
  action: string;
  outcome: "success" | "failure";
  target?: string;
}

const FORBIDDEN = /(name|address|email|ssn|income)/i;

/** Structured audit event (AU-3). Detail keys that look like PII are rejected. */
export function auditEvent(
  e: Omit<AuditEvent, "time">,
  sink: (line: string) => void = console.log,
  now = new Date(),
): AuditEvent {
  for (const v of [e.actor, e.action, e.target ?? ""]) {
    if (FORBIDDEN.test(v)) throw new Error("Audit events must not contain PII fields");
  }
  const ev: AuditEvent = { time: now.toISOString(), ...e };
  sink(JSON.stringify(ev));
  return ev;
}
