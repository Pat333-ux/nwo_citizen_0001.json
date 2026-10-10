/**
 * In-memory failed-login throttle (AC-7). Per process: with several instances
 * a shared store (e.g. PostgreSQL or Redis) is needed.
 */
export class LoginThrottle {
  #fails = new Map<string, { count: number; first: number; lockedUntil: number }>();
  #max: number;
  #windowMs: number;
  #lockMs: number;

  constructor(max = 5, windowMs = 15 * 60_000, lockMs = 15 * 60_000) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#lockMs = lockMs;
  }

  isLocked(key: string, now = Date.now()): boolean {
    const e = this.#fails.get(key);
    return !!e && e.lockedUntil > now;
  }

  recordFailure(key: string, now = Date.now()): void {
    let e = this.#fails.get(key);
    if (!e || now - e.first > this.#windowMs) e = { count: 0, first: now, lockedUntil: 0 };
    e.count += 1;
    if (e.count >= this.#max) e.lockedUntil = now + this.#lockMs;
    this.#fails.set(key, e);
    if (this.#fails.size > 10_000) this.#prune(now);
  }

  recordSuccess(key: string): void {
    this.#fails.delete(key);
  }

  #prune(now: number): void {
    for (const [k, e] of this.#fails) if (e.lockedUntil < now && now - e.first > this.#windowMs) this.#fails.delete(k);
  }
}
