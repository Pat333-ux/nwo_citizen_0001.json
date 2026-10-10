import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 (SHA-1, 6 digits, 30 s step) for a given counter step. */
export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const n = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

export const currentStep = (now = Date.now()): number => Math.floor(now / 1000 / TOTP_STEP_SECONDS);

/**
 * Returns the matching time step (within ±1 step of clock skew) that is greater than
 * `lastUsedStep`, or undefined. Requiring a newer step prevents replay of a used code.
 */
export function verifyTotp(secret: string, code: string, lastUsedStep = 0, now = Date.now()): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const cur = currentStep(now);
  let match: number | undefined;
  for (const step of [cur - 1, cur, cur + 1]) {
    const a = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(a, Buffer.from(code)) && step > lastUsedStep) match = step;
  }
  return match;
}

export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_STEP_SECONDS}`;
}
