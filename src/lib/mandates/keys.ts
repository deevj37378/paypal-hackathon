import { createHash } from "node:crypto";
import { calculateJwkThumbprint, exportJWK, importPKCS8, type JWK } from "jose";
import { env } from "@/lib/env";

/**
 * ES256 key for AP2-style signed mandates and purchase receipts. The private key lives only in
 * MANDATE_SIGNING_KEY (PKCS#8 PEM, "\n"-escaped is fine); the public half is published at
 * /.well-known/jwks.json so anyone (a merchant, a judge) can verify what Allowance signed.
 */
export const ALG = "ES256";

type Keys = { privateKey: CryptoKey; publicJwk: JWK & { kid: string } };
let cached: Promise<Keys> | null = null;

export function signingConfigured() {
  return Boolean(env().MANDATE_SIGNING_KEY);
}

export function getKeys(): Promise<Keys> {
  cached ??= (async () => {
    const pem = env().MANDATE_SIGNING_KEY;
    if (!pem) throw new Error("MANDATE_SIGNING_KEY is not set");
    const privateKey = await importPKCS8(pem.replace(/\\n/g, "\n"), ALG, { extractable: true });
    const full = await exportJWK(privateKey);
    const pub: JWK = { kty: full.kty, crv: full.crv, x: full.x, y: full.y };
    const kid = await calculateJwkThumbprint(pub);
    return { privateKey, publicJwk: { ...pub, kid, alg: ALG, use: "sig" } };
  })();
  return cached;
}

export async function jwks() {
  if (!signingConfigured()) return { keys: [] };
  return { keys: [(await getKeys()).publicJwk] };
}

/** Stable JSON (sorted keys) so the same mandate always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (s: string) => `sha256:${createHash("sha256").update(s).digest("base64url")}`;
