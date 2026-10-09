import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** AES-256-GCM. Key (32 bytes) must come from a KMS/HSM in production (FIPS 140-3 module TODO). */
export function encryptPII(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("Key must be 32 bytes");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decryptPII(token: string, key: Buffer): string {
  const [iv, tag, ct] = token.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
