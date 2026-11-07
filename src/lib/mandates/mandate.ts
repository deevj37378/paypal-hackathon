import { createLocalJWKSet, decodeJwt, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { env } from "@/lib/env";
import { formatUsd } from "@/lib/money";
import { ruleCards } from "@/lib/policy/describe";
import type { PolicyRules } from "@/lib/policy/schema";
import { ALG, canonicalJson, getKeys, jwks, sha256 } from "./keys";

/**
 * AP2-style signed mandates (modelled on Google's Agent Payments Protocol v0.2 types, not a
 * certified AP2 implementation):
 * - IntentMandate: what the owner allows, in their words plus Allowance's strict limits.
 * - Purchase receipt (PaymentMandate-style): one charged purchase, the rule check that allowed it,
 *   how it was approved, and the hash of the IntentMandate it was checked against.
 * Both are compact JWS (ES256), verifiable with the public key at /.well-known/jwks.json.
 */
export const AP2_VERSION = "0.2";

const dollars = (c: number | null) => (c === null ? null : (c / 100).toFixed(2));
const secs = (d: Date) => Math.floor(d.getTime() / 1000);
/** Standing rules reset monthly, so a standing IntentMandate expires at the end of the month. */
export const endOfMonthUtc = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1) - 1000);

export type PolicyRow = { id: string; userId: string; rules: PolicyRules; sourceText: string | null; createdAt: Date };
export type GrantRow = {
  id: string;
  userId: string;
  description: string;
  amountCents: number;
  category: string | null;
  merchantId: string | null;
  expiresAt: Date;
  createdAt: Date;
};

/** IntentMandate claims for the owner's standing rules, as of `at` (deterministic for a policy + month). */
export function intentMandateForPolicy(policy: PolicyRow, at: Date, merchantNames: Record<string, string> = {}) {
  const r = policy.rules;
  const expiry = endOfMonthUtc(at);
  const description =
    policy.sourceText?.trim() ||
    ruleCards(r, merchantNames)
      .map((c) => `${c.title}: ${c.value}`)
      .join(". ");
  return {
    iss: env().APP_URL,
    sub: policy.userId,
    jti: `im_${policy.id}_${expiry.toISOString().slice(0, 7)}`,
    iat: secs(policy.createdAt),
    exp: secs(expiry),
    ap2: { version: AP2_VERSION, mandate_type: "IntentMandate", conformance: "AP2-style, not certified" },
    intent_mandate: {
      natural_language_description: description,
      merchants: r.trustedMerchants.map((m) => merchantNames[m] ?? m),
      skus: null,
      requires_refundability: true,
      user_cart_confirmation_required: false,
      intent_expiry: expiry.toISOString(),
    },
    allowance: {
      kind: "standing_rules",
      policy_id: policy.id,
      currency: r.currency,
      monthly_limit: dollars(r.monthlyLimitCents),
      per_order_limit: dollars(r.perOrderLimitCents),
      ask_owner_above: dollars(r.approvalThresholdCents),
      allowed_categories: r.allowedCategories,
      blocked_categories: r.blockedCategories,
      blocked_merchants: r.blockedMerchants,
      trusted_merchants: r.trustedMerchants,
      ask_before_new_merchants: r.requireApprovalForNewMerchants,
      pace: r.velocity ? { max_purchases: r.velocity.maxPurchases, window_minutes: r.velocity.windowMinutes } : null,
      ask_before_repeat_within_days: r.duplicateWindowDays,
      note: "Holds (ask_owner_above, new merchants, pace, repeats) mean the owner confirms that cart; blocks are never allowed.",
    },
  };
}

/** IntentMandate claims for a one-time allowance ("a birthday gift up to $60 by Friday"). */
export function intentMandateForGrant(g: GrantRow, merchantNames: Record<string, string> = {}) {
  return {
    iss: env().APP_URL,
    sub: g.userId,
    jti: `im_${g.id}`,
    iat: secs(g.createdAt),
    exp: secs(g.expiresAt),
    ap2: { version: AP2_VERSION, mandate_type: "IntentMandate", conformance: "AP2-style, not certified" },
    intent_mandate: {
      natural_language_description: g.description,
      merchants: g.merchantId ? [merchantNames[g.merchantId] ?? g.merchantId] : null,
      skus: null,
      requires_refundability: true,
      user_cart_confirmation_required: false,
      intent_expiry: g.expiresAt.toISOString(),
    },
    allowance: {
      kind: "one_time",
      grant_id: g.id,
      currency: "USD",
      max_total: dollars(g.amountCents),
      category: g.category,
      merchant_id: g.merchantId,
      uses: 1,
      summary: `One purchase up to ${formatUsd(g.amountCents)}${g.category ? ` in ${g.category}` : ""}${g.merchantId ? ` at ${merchantNames[g.merchantId] ?? g.merchantId}` : ""}, before ${g.expiresAt.toISOString()}.`,
    },
  };
}

/** Hash that a receipt uses to point at the exact mandate it was checked against. */
export const mandateHash = (claims: object) => sha256(canonicalJson(claims));

export async function sign(claims: JWTPayload, typ: string) {
  const { privateKey, publicJwk } = await getKeys();
  return new SignJWT(claims).setProtectedHeader({ alg: ALG, kid: publicJwk.kid, typ }).sign(privateKey);
}

/** Receipt id is known before the charge so it can go on the PayPal order. */
export const receiptIdFor = (purchaseId: string) => `rcpt_${purchaseId.replace(/^pur_/, "")}`;

export type VerifyResult = { valid: true; payload: JWTPayload; header: { alg: string; kid?: string; typ?: string } } | { valid: false; error: string; payload?: JWTPayload };

/** Verify any Allowance mandate or receipt against our published JWKS. */
export async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const keySet = createLocalJWKSet(await jwks());
    const { payload, protectedHeader } = await jwtVerify(token.trim(), keySet, { issuer: env().APP_URL, algorithms: [ALG] });
    return { valid: true, payload, header: protectedHeader as { alg: string; kid?: string; typ?: string } };
  } catch (e) {
    let payload: JWTPayload | undefined;
    try {
      payload = decodeJwt(token.trim());
    } catch {
      payload = undefined;
    }
    const msg = (e as { code?: string; message?: string }).code === "ERR_JWT_EXPIRED" ? "Signature is valid, but the mandate has expired." : "Signature check failed: not signed by Allowance, or the contents were changed.";
    return { valid: false, error: msg, payload };
  }
}
