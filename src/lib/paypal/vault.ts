import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { PayPalError, paypalFetch } from "./client";

/**
 * PayPal Vault v3: "save PayPal without purchase".
 * Docs: https://developer.paypal.com/sdk/save-without-purchase/paypal
 *       https://developer.paypal.com/api/payment-tokens/save-without-purchase/paypal
 */

/** Browser-safe client token for JS SDK v6 (`createInstance({ clientToken })`). Required for vaulting. */
export async function createBrowserClientToken(): Promise<{ accessToken: string; expiresIn: number }> {
  const { PAYPAL_API_BASE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, APP_URL } = env();
  const params = new URLSearchParams({ grant_type: "client_credentials", response_type: "client_token" });
  // PayPal rejects `localhost` as a domain (invalid_domain); only bind the token to real deployed hosts.
  const host = new URL(APP_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") params.append("domains[]", host);

  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) {
    throw new PayPalError(
      `Client token failed: ${data.error_description ?? res.statusText}`,
      res.status,
      res.headers.get("paypal-debug-id") ?? undefined,
      data,
    );
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

type SetupTokenResponse = { id: string; status: string; customer?: { id: string } };

/** Step 1: setup token (status PAYER_ACTION_REQUIRED) that the JS SDK opens for buyer consent. */
export async function createSetupToken(opts: { paypalCustomerId?: string } = {}) {
  const { APP_URL } = env();
  return paypalFetch<SetupTokenResponse>("/v3/vault/setup-tokens", {
    body: {
      ...(opts.paypalCustomerId ? { customer: { id: opts.paypalCustomerId } } : {}),
      payment_source: {
        paypal: {
          description: "Allowance: let your AI agents spend within the rules you set",
          permit_multiple_payment_tokens: false,
          usage_pattern: "IMMEDIATE",
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            shipping_preference: "NO_SHIPPING",
            brand_name: "Allowance",
            locale: "en-US",
            return_url: `${APP_URL}/spike/vault?result=approved`,
            cancel_url: `${APP_URL}/spike/vault?result=cancelled`,
          },
        },
      },
    },
  });
}

export type PaymentTokenResponse = {
  id: string;
  customer?: { id: string };
  payment_source?: { paypal?: { email_address?: string; payer_id?: string; name?: unknown } };
};

/** Step 2: convert the buyer-approved setup token into a long-lived payment token and store it. */
export async function savePaymentToken(userId: string, setupTokenId: string) {
  const token = await paypalFetch<PaymentTokenResponse>("/v3/vault/payment-tokens", {
    // Stable idempotency key: retrying the same setup token can't create two vault records.
    requestId: `ptoken-${setupTokenId}`,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });

  // Only one active PayPal wallet per user: revoke older ones.
  await db()
    .update(schema.paypalVaults)
    .set({ status: "revoked" })
    .where(eq(schema.paypalVaults.userId, userId));

  await db()
    .insert(schema.paypalVaults)
    .values({
      id: randomUUID(),
      userId,
      paymentTokenId: token.id,
      paypalCustomerId: token.customer?.id,
      payerEmail: token.payment_source?.paypal?.email_address,
      status: "active",
      raw: token,
    })
    .onConflictDoUpdate({
      target: schema.paypalVaults.paymentTokenId,
      set: { status: "active", userId },
    });

  return token;
}
