import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { spentThisMonthCents } from "@/lib/purchases/service";
import { getActivePolicy, getActiveVault, getUser } from "@/lib/users";

export async function getDashboard(userId: string) {
  const [user, vault, policy, spent, agents, purchases] = await Promise.all([
    getUser(userId),
    getActiveVault(userId),
    getActivePolicy(userId),
    spentThisMonthCents(userId),
    db().select().from(schema.agents).where(eq(schema.agents.userId, userId)).orderBy(desc(schema.agents.createdAt)),
    db()
      .select({ purchase: schema.purchases, agentName: schema.agents.name, merchantName: schema.merchants.name })
      .from(schema.purchases)
      .leftJoin(schema.agents, eq(schema.purchases.agentId, schema.agents.id))
      .leftJoin(schema.merchants, eq(schema.purchases.merchantId, schema.merchants.id))
      .where(eq(schema.purchases.userId, userId))
      .orderBy(desc(schema.purchases.createdAt))
      .limit(50),
  ]);
  return { user, vault, policy, spent, agents, purchases };
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
