import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { createAgent } from "@/lib/agents";
import { newId } from "@/lib/ids";
import { DEFAULT_POLICY } from "@/lib/policy/schema";
import { reservePurchase } from "@/lib/purchases/service";
import { createUser } from "@/lib/users";
import { handleWebhookEvent } from "./webhooks";

/** Webhook handling logic with synthetic (already-verified) events. Signature verification is PayPal-side. */
describe("PayPal webhook handling", () => {
  const merchantId = `wh-${randomUUID().slice(0, 8)}`;
  let userId = "";
  let agent: typeof schema.agents.$inferSelect;
  const order = (cents: number) => ({
    merchant: { id: merchantId, name: "Webhook Shop" },
    items: [{ productId: `${merchantId}-item`, name: "Thing", category: "test", quantity: 1, unitPriceCents: cents }],
    totalCents: cents,
  });
  const input = { merchant_id: merchantId, items: [{ product_id: `${merchantId}-item`, quantity: 1 }], total: "10.00", currency: "USD" };
  const evt = (event_type: string, resource: object) => ({ id: `WH-TEST-${randomUUID()}`, event_type, resource });
  const get = async (id: string) => (await db().select().from(schema.purchases).where(eq(schema.purchases.id, id)))[0];

  beforeAll(async () => {
    userId = await createUser({ name: "webhook test" });
    await db()
      .update(schema.policies)
      .set({ rules: { ...DEFAULT_POLICY, allowedCategories: [], approvalThresholdCents: null, requireApprovalForNewMerchants: false } })
      .where(eq(schema.policies.userId, userId));
    await db().insert(schema.paypalVaults).values({ id: newId("vlt"), userId, paymentTokenId: `fake-${userId}`, status: "active" });
    await db().insert(schema.merchants).values({ id: merchantId, name: "Webhook Shop", payoutEmail: "wh@example.com" });
    await db().insert(schema.products).values({ id: `${merchantId}-item`, merchantId, name: "Thing", category: "test", priceCents: 1000 });
    const c = await createAgent(userId, "wh agent");
    [agent] = await db().select().from(schema.agents).where(eq(schema.agents.id, c.agent.id));
  });

  afterAll(async () => {
    if (userId) await db().delete(schema.users).where(eq(schema.users.id, userId));
    await db().delete(schema.merchants).where(eq(schema.merchants.id, merchantId));
  });

  it("reconciles a charge whose response was lost (processing → captured), once", async () => {
    const { purchase } = await reservePurchase(agent, input, order(1000));
    expect(purchase.status).toBe("processing"); // as if our PayPal call timed out
    const e = evt("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-TEST-1", custom_id: purchase.id, status: "COMPLETED", supplementary_data: { related_ids: { order_id: "ORD-TEST-1" } } });
    expect(await handleWebhookEvent(e)).toBe("reconciled: captured");
    const p = await get(purchase.id);
    expect(p.status).toBe("captured");
    expect(p.paypalCaptureId).toBe("CAP-TEST-1");
    expect(p.payoutStatus).toBe("scheduled");
    expect(await handleWebhookEvent(e)).toBe("duplicate");
  });

  it("confirms payouts and records refunds made outside Allowance", async () => {
    const { purchase } = await reservePurchase(agent, input, order(1000));
    await handleWebhookEvent(evt("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-TEST-2", custom_id: purchase.id }));
    await db().update(schema.purchases).set({ payoutStatus: "sent", payoutCents: 1000 }).where(eq(schema.purchases.id, purchase.id));
    expect(await handleWebhookEvent(evt("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", { payout_item: { sender_item_id: purchase.id } }))).toBe("payout paid");
    expect((await get(purchase.id)).payoutStatus).toBe("paid");

    const refund = evt("PAYMENT.CAPTURE.REFUNDED", {
      id: "REF-TEST-2",
      links: [{ rel: "up", href: "https://api.sandbox.paypal.com/v2/payments/captures/CAP-TEST-2" }],
    });
    expect(await handleWebhookEvent(refund)).toMatch(/refund recorded \(refunded\)/);
    expect((await get(purchase.id)).status).toBe("refunded");
    const [m] = await db().select().from(schema.merchants).where(eq(schema.merchants.id, merchantId));
    expect(m.clawbackCents).toBe(1000); // merchant was already paid
  });

  it("marks denied captures failed and cancels the held payout", async () => {
    const { purchase } = await reservePurchase(agent, input, order(1000));
    await handleWebhookEvent(evt("PAYMENT.CAPTURE.COMPLETED", { id: "CAP-TEST-3", custom_id: purchase.id }));
    expect(await handleWebhookEvent(evt("PAYMENT.CAPTURE.DENIED", { id: "CAP-TEST-3", custom_id: purchase.id }))).toBe("marked failed");
    const p = await get(purchase.id);
    expect(p.status).toBe("failed");
    expect(p.payoutStatus).toBe("cancelled");
  });
});
