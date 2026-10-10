/** In-process counters and gauges for operations monitoring. Labels are never PII. */
export type Counter = "failed_logins" | "mfa_failures" | "mfa_resets" | "ledger_verify_failures" | "anchor_failures" | "db_check_failures";

export class Metrics {
  #c: Record<Counter, number> = {
    failed_logins: 0, mfa_failures: 0, mfa_resets: 0, ledger_verify_failures: 0, anchor_failures: 0, db_check_failures: 0,
  };
  #g = new Map<string, number>();
  inc(name: Counter): void {
    this.#c[name]++;
  }
  set(name: string, v: number): void {
    this.#g.set(name, v);
  }
  snapshot(): Record<string, number> {
    return { ...this.#c, ...Object.fromEntries(this.#g) };
  }
  /** Prometheus text exposition format. */
  prometheus(): string {
    return Object.entries(this.snapshot()).map(([k, v]) => `# TYPE beast_${k} ${k in this.#c ? "counter" : "gauge"}\nbeast_${k} ${v}`).join("\n") + "\n";
  }
}

export interface HealthDeps {
  ping: () => Promise<void>;
  verifyLedger: () => Promise<{ valid: boolean }>;
}

export type Alert = (severity: "critical" | "high", message: string) => void;

/** Runs the DB and ledger checks, updating metrics and raising an alert on any failure. */
export async function runHealthChecks(deps: HealthDeps, m: Metrics, alert: Alert): Promise<void> {
  try {
    await deps.ping();
    m.set("db_up", 1);
  } catch {
    m.set("db_up", 0);
    m.inc("db_check_failures");
    alert("critical", "database unreachable");
    return;
  }
  try {
    const v = await deps.verifyLedger();
    m.set("ledger_valid", v.valid ? 1 : 0);
    if (!v.valid) {
      m.inc("ledger_verify_failures");
      alert("critical", "ledger verification failed: possible tampering");
    }
  } catch {
    m.inc("ledger_verify_failures");
    m.set("ledger_valid", 0);
    alert("critical", "ledger verification could not run");
  }
}

export function startHealthSchedule(deps: HealthDeps, m: Metrics, alert: Alert, intervalMs: number): () => void {
  const t = setInterval(() => void runHealthChecks(deps, m, alert), intervalMs);
  t.unref();
  void runHealthChecks(deps, m, alert);
  return () => clearInterval(t);
}

/** Delivers alerts to stdout and, if configured, a webhook (JSON POST). Webhook errors are logged, never thrown. */
export function makeAlerter(log: (l: string) => void, webhookUrl?: string): Alert {
  return (severity, message) => {
    log(JSON.stringify({ alert: true, severity, message, time: new Date().toISOString() }));
    if (webhookUrl) {
      fetch(webhookUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ severity, message, text: `[BEAST ${severity}] ${message}` }),
        signal: AbortSignal.timeout(10_000),
      }).catch((e: Error) => log(`alert webhook failed: ${e.message}`));
    }
  };
}
