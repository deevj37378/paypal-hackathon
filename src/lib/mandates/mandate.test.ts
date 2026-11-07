import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_POLICY } from "@/lib/policy/schema";

const pem = () => generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://u:p@localhost/db");
  vi.stubEnv("PAYPAL_CLIENT_ID", "x");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "x");
  vi.stubEnv("STORE_PAYPAL_EMAIL", "store@example.com");
  vi.stubEnv("SESSION_SECRET", "x".repeat(40));
  vi.stubEnv("APP_URL", "https://allowance.test");
  vi.stubEnv("MANDATE_SIGNING_KEY", pem().replace(/\n/g, "\\n"));
});

const policy = { id: "pol_1", userId: "usr_1", rules: DEFAULT_POLICY, sourceText: "$150 a month, only coffee and books.", createdAt: new Date("2026-11-01T00:00:00Z") };

describe("AP2-style mandates", () => {
  it("builds an IntentMandate from the rules, expiring at the end of the month", async () => {
    const { intentMandateForPolicy } = await import("./mandate");
    const m = intentMandateForPolicy(policy, new Date("2026-11-08T12:00:00Z"), { "demo-store": "Bean & Page" });
    expect(m.intent_mandate.natural_language_description).toBe("$150 a month, only coffee and books.");
    expect(m.intent_mandate.intent_expiry).toBe("2026-11-30T23:59:59.000Z");
    expect(m.intent_mandate.merchants).toEqual(["Bean & Page"]);
    expect(m.allowance.per_order_limit).toBe("40.00");
    expect(m.allowance.pace).toEqual({ max_purchases: 3, window_minutes: 10 });
  });

  it("hashes the same mandate the same way regardless of key order", async () => {
    const { mandateHash } = await import("./mandate");
    expect(mandateHash({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(mandateHash({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(mandateHash({ a: 1 })).not.toBe(mandateHash({ a: 2 }));
  });

  it("signs and verifies; a changed payload or another key fails", async () => {
    const { intentMandateForPolicy, sign, verifyToken } = await import("./mandate");
    const claims = intentMandateForPolicy(policy, new Date());
    const jws = await sign(claims, "ap2-intent-mandate+jwt");
    const ok = await verifyToken(jws);
    expect(ok.valid).toBe(true);
    if (ok.valid) expect(ok.header.alg).toBe("ES256");

    const [h, body, sig] = jws.split(".");
    const tampered = JSON.parse(Buffer.from(body, "base64url").toString());
    tampered.allowance.monthly_limit = "9999.00";
    const forged = `${h}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${sig}`;
    expect((await verifyToken(forged)).valid).toBe(false);

    const { SignJWT, importPKCS8 } = await import("jose");
    const other = await new SignJWT(claims).setProtectedHeader({ alg: "ES256" }).sign(await importPKCS8(pem(), "ES256"));
    expect((await verifyToken(other)).valid).toBe(false);
  });

  it("publishes only the public key", async () => {
    const { jwks } = await import("./keys");
    const { keys } = await jwks();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect("d" in keys[0]).toBe(false);
  });

  it("receipt ids are known before the charge", async () => {
    const { receiptIdFor } = await import("./mandate");
    expect(receiptIdFor("pur_abc123")).toBe("rcpt_abc123");
  });
});
