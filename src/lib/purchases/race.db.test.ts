import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { createAgent } from "@/lib/agents";
import { newId } from "@/lib/ids";
import { DEFAULT_POLICY } from "@/lib/policy/schema";
import { createUser } from "@/lib/users";
import { reservePurchase, spentThisMonthCents } from "./service";

/**
 * Agents call tools in parallel. Five simultaneous $30 purchases against a $100 monthly
 * limit must never overspend: exactly 3 can be reserved, the other 2 are blocked.
 */
describe("parallel purchases can't exceed the monthly limit", () => {
  const merchantId = `race-${newId("evt").slice(4, 12)}`;
  let userId = "";
  let agent: typeof schema.agents.$inferSelect;

  beforeAll(async () => {
    userId = await createUser({ name: "race test" });
    await db()
      .update(schema.policies)
      .set({
        rules: {
          ...DEFAULT_POLICY,
          monthlyLimitCents: 10_000,
          perOrderLimitCents: null,
          approvalThresholdCents: null,
          allowedCategories: [],
          requireApprovalForNewMerchants: false,
        },
      })
      .where(eq(schema.policies.userId, userId));
    await db().insert(schema.paypalVaults).values({ id: newId("vlt"), userId, paymentTokenId: `fake-${userId}`, status: "active" });
    await db().insert(schema.merchants).values({ id: merchantId, name: "Race Test Shop", payoutEmail: "race@example.com" });
    await db().insert(schema.products).values({ id: `${merchantId}-item`, merchantId, name: "Thirty", category: "test", priceCents: 3000 });
    const created = await createAgent(userId, "race agent");
    [agent] = await db().select().from(schema.agents).where(eq(schema.agents.id, created.agent.id));
  });

  afterAll(async () => {
    if (userId) await db().delete(schema.users).where(eq(schema.users.id, userId));
    await db().delete(schema.merchants).where(eq(schema.merchants.id, merchantId));
  });

  it("reserves at most 3 of 5 parallel $30 purchases against $100", async () => {
    const order = {
      merchant: { id: merchantId, name: "Race Test Shop" },
      items: [{ productId: `${merchantId}-item`, name: "Thirty", category: "test", quantity: 1, unitPriceCents: 3000 }],
      totalCents: 3000,
    };
    const input = {
      merchant_id: merchantId,
      items: [{ product_id: `${merchantId}-item`, quantity: 1 }],
      total: "30.00",
      currency: "USD",
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => reservePurchase(agent, input, order)));
    const statuses = results.map((r) => r.purchase.status).sort();
    expect(statuses.filter((s) => s === "processing")).toHaveLength(3);
    expect(statuses.filter((s) => s === "blocked")).toHaveLength(2);
    expect(await spentThisMonthCents(userId)).toBe(9000);
    const blocked = results.find((r) => r.purchase.status === "blocked")!;
    expect(blocked.purchase.decision.reasons[0]).toMatch(/Only \$10\.00 of your \$100\.00/);
  });

  it("idempotency key under concurrency yields one purchase", async () => {
    const order = {
      merchant: { id: merchantId, name: "Race Test Shop" },
      items: [{ productId: `${merchantId}-item`, name: "Thirty", category: "test", quantity: 1, unitPriceCents: 3000 }],
      totalCents: 3000,
    };
    const input = { merchant_id: merchantId, items: [{ product_id: `${merchantId}-item`, quantity: 1 }], total: "30.00", currency: "USD", idempotency_key: "same-key-123" };
    const results = await Promise.all(Array.from({ length: 4 }, () => reservePurchase(agent, input, order)));
    expect(new Set(results.map((r) => r.purchase.id)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });
});
