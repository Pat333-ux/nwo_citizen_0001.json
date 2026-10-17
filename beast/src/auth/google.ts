import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

export interface GoogleIdentity {
  sub: string;
  email: string;
}

export type GoogleVerifier = (idToken: string) => Promise<GoogleIdentity | undefined>;
export type KeyProvider = () => Promise<JsonWebKey[]>;

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

const b64 = (s: string) => Buffer.from(s, "base64url");

/** Fetches Google's signing keys, cached for up to an hour. */
export function googleKeyProvider(fetchFn: typeof fetch = fetch): KeyProvider {
  let cache: { keys: JsonWebKey[]; at: number } | undefined;
  return async () => {
    if (cache && Date.now() - cache.at < 3_600_000) return cache.keys;
    const res = await fetchFn(JWKS_URL);
    if (!res.ok) throw new Error("could not fetch Google keys");
    const body = (await res.json()) as { keys: JsonWebKey[] };
    cache = { keys: body.keys, at: Date.now() };
    return cache.keys;
  };
}

/** Verifies a Google ID token (RS256 signature, issuer, audience, expiry, verified email). Returns undefined if invalid. */
export function createGoogleVerifier(clientId: string, keys: KeyProvider = googleKeyProvider(), now: () => number = Date.now): GoogleVerifier {
  if (!clientId) throw new Error("Google client id required");
  return async (idToken) => {
    try {
      const parts = idToken.split(".");
      if (parts.length !== 3) return undefined;
      const header = JSON.parse(b64(parts[0]!).toString("utf8")) as { alg?: string; kid?: string };
      if (header.alg !== "RS256" || !header.kid) return undefined;
      const jwk = (await keys()).find((k) => (k as { kid?: string }).kid === header.kid);
      if (!jwk) return undefined;
      const ok = createVerify("RSA-SHA256")
        .update(`${parts[0]}.${parts[1]}`)
        .verify(createPublicKey({ key: jwk, format: "jwk" }), b64(parts[2]!));
      if (!ok) return undefined;
      const c = JSON.parse(b64(parts[1]!).toString("utf8")) as {
        iss?: string; aud?: string; exp?: number; sub?: string; email?: string; email_verified?: boolean;
      };
      if (!c.iss || !ISSUERS.has(c.iss) || c.aud !== clientId) return undefined;
      if (typeof c.exp !== "number" || c.exp * 1000 <= now()) return undefined;
      if (!c.sub || !c.email || c.email_verified !== true) return undefined;
      return { sub: c.sub, email: c.email.toLowerCase() };
    } catch {
      return undefined;
    }
  };
}
