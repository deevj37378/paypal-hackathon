import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { DbExecutor } from "@/db/tx";
import { newId } from "@/lib/ids";
import type { CheckItem } from "@/lib/policy/check";

/**
 * One-time allowances: a task-scoped, single-use permission ("a birthday gift up to $60 by Friday").
 * The deterministic checker treats a matching one as covering scope and approval for exactly one
 * purchase; it is claimed under the same per-user lock as the purchase itself.
 */
export type Grant = typeof schema.oneTimeAllowances.$inferSelect;

export const MAX_GRANT_CENTS = 100_000; // $1,000
export const MAX_GRANT_DAYS = 60;

/** Unused, uncancelled, unexpired allowance this order fits (earliest expiry first). */
export async function findMatchingGrant(
  ex: DbExecutor,
  userId: string,
  order: { merchantId: string; items: CheckItem[]; totalCents: number },
) {
  const rows = await ex
    .select()
    .from(schema.oneTimeAllowances)
    .where(
      and(
        eq(schema.oneTimeAllowances.userId, userId),
        isNull(schema.oneTimeAllowances.usedPurchaseId),
        isNull(schema.oneTimeAllowances.cancelledAt),
        gt(schema.oneTimeAllowances.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.oneTimeAllowances.expiresAt));
  return (
    rows.find(
      (g) =>
        order.totalCents <= g.amountCents &&
        (!g.merchantId || g.merchantId === order.merchantId) &&
        (!g.category || order.items.every((i) => i.category === g.category)),
    ) ?? null
  );
}

/** Claim it for a purchase (inside the user lock). False if something else claimed it first. */
export async function claimGrant(ex: DbExecutor, grantId: string, purchaseId: string) {
  const [row] = await ex
    .update(schema.oneTimeAllowances)
    .set({ usedPurchaseId: purchaseId })
    .where(and(eq(schema.oneTimeAllowances.id, grantId), isNull(schema.oneTimeAllowances.usedPurchaseId)))
    .returning({ id: schema.oneTimeAllowances.id });
  return Boolean(row);
}

/** The charge failed: the allowance is free again. */
export async function releaseGrant(purchaseId: string) {
  await db().update(schema.oneTimeAllowances).set({ usedPurchaseId: null }).where(eq(schema.oneTimeAllowances.usedPurchaseId, purchaseId));
}

export async function createGrant(userId: string, g: { description: string; amountCents: number; category: string | null; merchantId: string | null; expiresAt: Date }) {
  const [row] = await db()
    .insert(schema.oneTimeAllowances)
    .values({ id: newId("ota"), userId, ...g })
    .returning();
  return row;
}

export async function cancelGrant(userId: string, id: string) {
  const [row] = await db()
    .update(schema.oneTimeAllowances)
    .set({ cancelledAt: new Date() })
    .where(and(eq(schema.oneTimeAllowances.id, id), eq(schema.oneTimeAllowances.userId, userId), isNull(schema.oneTimeAllowances.usedPurchaseId)))
    .returning();
  return row ?? null;
}

/** Active ones plus those used or ended in the last 7 days (dashboard / rules page). */
export async function listGrants(userId: string) {
  return db()
    .select()
    .from(schema.oneTimeAllowances)
    .where(and(eq(schema.oneTimeAllowances.userId, userId), gt(schema.oneTimeAllowances.expiresAt, sql`now() - interval '7 days'`)))
    .orderBy(desc(schema.oneTimeAllowances.createdAt))
    .limit(10);
}

export type GrantState = "active" | "used" | "expired" | "cancelled";
export function grantState(g: Grant, now = new Date()): GrantState {
  if (g.usedPurchaseId) return "used";
  if (g.cancelledAt) return "cancelled";
  if (g.expiresAt <= now) return "expired";
  return "active";
}
