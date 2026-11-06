import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { createAgent } from "@/lib/agents";
import { newId } from "@/lib/ids";
import { logEvent } from "@/lib/purchases/events";
import { getAnalyticsData } from "@/lib/analytics/data";
import { ARCHIVE_USER_ID, cleanupExpiredDemos, createUser } from "@/lib/users";

/** Expired demo accounts lose their login data but their purchase history is kept for analytics. */
describe("demo cleanup keeps purchase history", () => {
  const purchaseId = newId("pur");
  afterAll(async () => {
    await db().delete(schema.purchases).where(eq(schema.purchases.id, purchaseId));
  });

  it("moves purchases, events and agents to the archive user, deletes the rest", async () => {
    const userId = await createUser({ isDemo: true, name: "expiring demo" });
    const { agent } = await createAgent(userId, "Claude Desktop");
    await db().insert(schema.purchases).values({
      id: purchaseId,
      userId,
      agentId: agent.id,
      merchantId: "demo-store",
      items: [{ productId: "coffee-house-blend", name: "House Blend", category: "coffee", quantity: 1, unitPriceCents: 1800 }],
      totalCents: 1800,
      status: "blocked",
      decision: { outcome: "blocked", reasons: ["test"], checks: [] },
    });
    await logEvent(purchaseId, "requested", "test event");
    await db().update(schema.users).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.users.id, userId));

    expect(await cleanupExpiredDemos()).toBeGreaterThanOrEqual(1);

    const [user] = await db().select().from(schema.users).where(eq(schema.users.id, userId));
    expect(user).toBeUndefined();
    const [p] = await db().select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId));
    expect(p.userId).toBe(ARCHIVE_USER_ID);
    const events = await db().select().from(schema.purchaseEvents).where(eq(schema.purchaseEvents.purchaseId, purchaseId));
    expect(events.length).toBe(1);
    const [a] = await db().select().from(schema.agents).where(eq(schema.agents.id, agent.id));
    expect(a.userId).toBe(ARCHIVE_USER_ID);
    expect(a.status).toBe("revoked");
    const analytics = await getAnalyticsData();
    expect(analytics.purchases.find((r) => r.id === purchaseId)?.agentType).toBe("Claude (MCP)");
  });
});
