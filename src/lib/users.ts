import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { env } from "@/lib/env";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/db/tx";
import { newId } from "@/lib/ids";
import { DEFAULT_POLICY, PolicyRules } from "@/lib/policy/schema";

/** New account with the starter policy (editable in plain English in M5). */
export async function createUser(opts: { isDemo?: boolean; name?: string } = {}) {
  const id = newId("usr");
  await db()
    .insert(schema.users)
    .values({ id, name: opts.name ?? null, isDemo: opts.isDemo ? 1 : 0, expiresAt: opts.isDemo ? new Date(Date.now() + 24 * 3600_000) : null });
  await db().insert(schema.policies).values({
    id: newId("pol"),
    userId: id,
    rules: DEFAULT_POLICY,
    sourceText:
      "$150/month, only coffee and books, max $40 per order, ask me before anything over $25, never buy from new merchants without asking.",
    status: "active",
  });
  return id;
}

export async function getUser(userId: string) {
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return u ?? null;
}

export async function getActivePolicy(userId: string, ex: DbExecutor = db()) {
  const [p] = await ex
    .select()
    .from(schema.policies)
    .where(and(eq(schema.policies.userId, userId), eq(schema.policies.status, "active")))
    .orderBy(desc(schema.policies.createdAt))
    .limit(1);
  return p ? { ...p, rules: PolicyRules.parse(p.rules) } : null;
}

export async function getActiveVault(userId: string, ex: DbExecutor = db()) {
  const [v] = await ex
    .select()
    .from(schema.paypalVaults)
    .where(and(eq(schema.paypalVaults.userId, userId), eq(schema.paypalVaults.status, "active")))
    .orderBy(desc(schema.paypalVaults.createdAt))
    .limit(1);
  if (v) return v;
  // Judge demo mode: demo accounts without their own link use the shared, pre-linked sandbox buyer.
  const demoToken = env().DEMO_PAYMENT_TOKEN_ID;
  if (!demoToken) return null;
  const [u] = await ex.select({ isDemo: schema.users.isDemo }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u?.isDemo) return null;
  return {
    id: "demo-vault",
    userId,
    paymentTokenId: demoToken,
    paypalCustomerId: null,
    payerEmail: env().DEMO_PAYER_EMAIL ?? "sandbox demo buyer",
    status: "active" as const,
    raw: null,
    createdAt: new Date(0),
  };
}

/** Delete expired demo accounts (purchases, agents, rules cascade). */
export async function cleanupExpiredDemos(limit = 50) {
  const rows = await db()
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.isDemo, 1), lt(schema.users.expiresAt, new Date())))
    .limit(limit);
  if (rows.length) await db().delete(schema.users).where(inArray(schema.users.id, rows.map((r) => r.id)));
  return rows.length;
}
