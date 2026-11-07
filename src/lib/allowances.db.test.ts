import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { createAgent } from "@/lib/agents";
import { newId } from "@/lib/ids";
import { reservePurchase } from "@/lib/purchases/service";
import { createUser } from "@/lib/users";
import { createGrant, releaseGrant } from "./allowances";

/** A one-time allowance covers exactly one matching purchase, even when two race for it. */
describe("one-time allowance", () => {
  const merchantId = `ota-${newId("evt").slice(4, 12)}`;
  let userId = "";
  let agent: typeof schema.agents.$inferSelect;
  const order = () => ({
    merchant: { id: merchantId, name: "Gift Shop" },
    items: [{ productId: `${merchantId}-gift`, name: "Gift", category: "gifts", quantity: 1, unitPriceCents: 5500 }],
    totalCents: 5500,
  });
  const input = () => ({ merchant_id: merchantId, items: [{ product_id: `${merchantId}-gift`, quantity: 1 }], total: "55.00", currency: "USD" });

  beforeAll(async () => {
    userId = await createUser({ name: "ota test" }); // default rules: coffee + books only, max $40/order
    await db().insert(schema.paypalVaults).values({ id: newId("vlt"), userId, paymentTokenId: `fake-${userId}`, status: "active" });
    await db().insert(schema.merchants).values({ id: merchantId, name: "Gift Shop", payoutEmail: "gift@example.com" });
    await db().insert(schema.products).values({ id: `${merchantId}-gift`, merchantId, name: "Gift", category: "gifts", priceCents: 5500 });
    const created = await createAgent(userId, "ota agent");
    [agent] = await db().select().from(schema.agents).where(eq(schema.agents.id, created.agent.id));
  });

  afterAll(async () => {
    if (userId) await db().delete(schema.users).where(eq(schema.users.id, userId));
    await db().delete(schema.merchants).where(eq(schema.merchants.id, merchantId));
  });

  it("blocks the gift without an allowance", async () => {
    const { purchase } = await reservePurchase(agent, input(), order());
    expect(purchase.status).toBe("blocked");
  });

  it("allows exactly one of two parallel gift purchases, then frees it if the charge fails", async () => {
    const g = await createGrant(userId, { description: "a birthday gift up to $60 by Friday", amountCents: 6000, category: "gifts", merchantId: null, expiresAt: new Date(Date.now() + 86_400_000) });
    const results = await Promise.all([reservePurchase(agent, input(), order()), reservePurchase(agent, input(), order())]);
    const statuses = results.map((r) => r.purchase.status).sort();
    expect(statuses).toEqual(["blocked", "processing"]);
    const winner = results.find((r) => r.purchase.status === "processing")!.purchase;
    expect(winner.grantId).toBe(g.id);
    const [after] = await db().select().from(schema.oneTimeAllowances).where(eq(schema.oneTimeAllowances.id, g.id));
    expect(after.usedPurchaseId).toBe(winner.id);

    await releaseGrant(winner.id);
    await db().update(schema.purchases).set({ status: "failed" }).where(eq(schema.purchases.id, winner.id));
    const again = await reservePurchase(agent, input(), order());
    expect(again.purchase.status).toBe("processing");
  });

  it("ignores an expired or too-small allowance", async () => {
    await db().update(schema.purchases).set({ status: "failed" }).where(eq(schema.purchases.userId, userId));
    await db().delete(schema.oneTimeAllowances).where(eq(schema.oneTimeAllowances.userId, userId));
    await createGrant(userId, { description: "expired", amountCents: 6000, category: "gifts", merchantId: null, expiresAt: new Date(Date.now() - 1000) });
    await createGrant(userId, { description: "too small", amountCents: 5000, category: "gifts", merchantId: null, expiresAt: new Date(Date.now() + 86_400_000) });
    expect((await reservePurchase(agent, input(), order())).purchase.status).toBe("blocked");
  });
});
