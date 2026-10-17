/** In-memory fixed-window rate limiter keyed by user. Per process; use a shared store with several instances. */
export class RateLimiter {
  #hits = new Map<string, { count: number; start: number }>();
  #max: number;
  #windowMs: number;

  constructor(max = 10, windowMs = 60_000) {
    this.#max = max;
    this.#windowMs = windowMs;
  }

  /** Returns true if the call is allowed and counts it. */
  allow(key: string, now = Date.now()): boolean {
    let e = this.#hits.get(key);
    if (!e || now - e.start >= this.#windowMs) e = { count: 0, start: now };
    if (e.count >= this.#max) return false;
    e.count += 1;
    this.#hits.set(key, e);
    if (this.#hits.size > 10_000) for (const [k, v] of this.#hits) if (now - v.start >= this.#windowMs) this.#hits.delete(k);
    return true;
  }
}
