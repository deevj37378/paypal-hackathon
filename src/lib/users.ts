import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { newId } from "@/lib/ids";
import { DEFAULT_POLICY, PolicyRules } from "@/lib/policy/schema";

/** New account with the starter policy (editable in plain English in M5). */
export async function createUser(opts: { isDemo?: boolean; name?: string } = {}) {
  const id = newId("usr");
  await db().insert(schema.users).values({ id, name: opts.name ?? null, isDemo: opts.isDemo ? 1 : 0 });
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

export async function getActivePolicy(userId: string) {
  const [p] = await db()
    .select()
    .from(schema.policies)
    .where(and(eq(schema.policies.userId, userId), eq(schema.policies.status, "active")))
    .orderBy(desc(schema.policies.createdAt))
    .limit(1);
  return p ? { ...p, rules: PolicyRules.parse(p.rules) } : null;
}

export async function getActiveVault(userId: string) {
  const [v] = await db()
    .select()
    .from(schema.paypalVaults)
    .where(and(eq(schema.paypalVaults.userId, userId), eq(schema.paypalVaults.status, "active")))
    .orderBy(desc(schema.paypalVaults.createdAt))
    .limit(1);
  return v ?? null;
}
