import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logEvent } from "@/lib/purchases/events";
import { PolicyRules } from "@/lib/policy/schema";
import { signingConfigured } from "./keys";
import { AP2_VERSION, intentMandateForGrant, intentMandateForPolicy, mandateHash, receiptIdFor, sign } from "./mandate";

export async function merchantNames() {
  const rows = await db().select({ id: schema.merchants.id, name: schema.merchants.name }).from(schema.merchants);
  return Object.fromEntries(rows.map((m) => [m.id, m.name]));
}

/**
 * Sign the AP2-style purchase receipt for a captured purchase and store it. Never throws: a
 * signing problem must not undo a completed charge (the receipt can be re-issued later).
 */
export async function issueReceipt(purchaseId: string) {
  try {
    if (!signingConfigured()) return null;
    const [row] = await db()
      .select({ p: schema.purchases, agentName: schema.agents.name, merchantName: schema.merchants.name })
      .from(schema.purchases)
      .leftJoin(schema.agents, eq(schema.purchases.agentId, schema.agents.id))
      .leftJoin(schema.merchants, eq(schema.purchases.merchantId, schema.merchants.id))
      .where(eq(schema.purchases.id, purchaseId))
      .limit(1);
    if (!row || row.p.status !== "captured") return null;
    const p = row.p;

    // The mandate this purchase was checked against: a one-time allowance, else the standing rules.
    // Built exactly as /api/mandate exports it (same merchant names), so the hashes match.
    const names = await merchantNames();
    let mandate: { id: string; hash: string; kind: string } | null = null;
    if (p.grantId) {
      const [g] = await db().select().from(schema.oneTimeAllowances).where(eq(schema.oneTimeAllowances.id, p.grantId)).limit(1);
      if (g) {
        const claims = intentMandateForGrant(g, names);
        mandate = { id: claims.jti, hash: mandateHash(claims), kind: "one_time" };
      }
    }
    if (!mandate && p.policyId) {
      const [pol] = await db().select().from(schema.policies).where(eq(schema.policies.id, p.policyId)).limit(1);
      if (pol) {
        const claims = intentMandateForPolicy({ ...pol, rules: PolicyRules.parse(pol.rules) }, p.createdAt, names);
        mandate = { id: claims.jti, hash: mandateHash(claims), kind: "standing_rules" };
      }
    }

    const receiptId = receiptIdFor(p.id);
    const capturedAt = p.capturedAt ?? new Date();
    const total = { currency: p.currency, value: (p.totalCents / 100).toFixed(2) };
    const claims = {
      iss: (await import("@/lib/env")).env().APP_URL,
      sub: p.userId,
      jti: receiptId,
      iat: Math.floor(capturedAt.getTime() / 1000),
      ap2: { version: AP2_VERSION, mandate_type: "PaymentMandate", conformance: "AP2-style purchase receipt, not certified" },
      payment_mandate_contents: {
        payment_mandate_id: receiptId,
        payment_details_id: p.id,
        payment_details_total: { label: "Total", amount: total },
        payment_response: { method_name: "PayPal", details: { order_id: p.paypalOrderId, capture_id: p.paypalCaptureId } },
        merchant_agent: row.merchantName ?? p.merchantId,
        timestamp: capturedAt.toISOString(),
      },
      allowance: {
        purchase_id: p.id,
        agent: { id: p.agentId, name: row.agentName },
        merchant: { id: p.merchantId, name: row.merchantName },
        items: p.items.map((i) => ({ product_id: i.productId, name: i.name, category: i.category, quantity: i.quantity, unit_price: (i.unitPriceCents / 100).toFixed(2) })),
        total,
        rule_check: { outcome: "approved", checks: p.decision.checks.map((c) => ({ id: c.id, status: c.status, detail: c.detail })) },
        approval: p.decidedAt ? { method: "owner", via: p.decidedVia, at: p.decidedAt.toISOString() } : { method: "auto", via: "rules", at: p.createdAt.toISOString() },
        intent_mandate: mandate,
        one_time_allowance_id: p.grantId,
      },
    };
    const jws = await sign(claims, "allowance-receipt+jwt");
    await db().update(schema.purchases).set({ receiptId, receiptJws: jws }).where(eq(schema.purchases.id, p.id));
    await logEvent(p.id, "receipt", `Signed receipt ${receiptId} issued (AP2-style, ES256).`, { receiptId, intentMandate: mandate });
    return jws;
  } catch (e) {
    console.error("[receipt]", (e as Error).message);
    return null;
  }
}
