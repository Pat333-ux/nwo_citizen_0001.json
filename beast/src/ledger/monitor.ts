import type { Ledger } from "./ledger.ts";

/** Periodically verifies the chain; calls onFailure (High severity incident) on a break. */
export function startChainMonitor(
  ledger: Ledger,
  intervalMs: number,
  onFailure: (brokenAt: number) => void,
): () => void {
  const t = setInterval(() => {
    const r = ledger.verify();
    if (!r.valid) onFailure(r.brokenAt ?? -1);
  }, intervalMs);
  t.unref();
  return () => clearInterval(t);
}
