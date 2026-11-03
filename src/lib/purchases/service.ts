import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { formatUsd, toCents } from "@/lib/money";
import { PayPalError } from "@/lib/paypal/client";
import { chargeVaultedWallet, refundCapture } from "@/lib/paypal/payments";
import { checkPurchase, type CheckItem, type CheckResult } from "@/lib/policy/check";
import { getActivePolicy, getActiveVault, getUser } from "@/lib/users";
import { logEvent } from "./events";

/** Thrown for bad agent input (unknown merchant/product). Becomes a 400 with a readable message. */
export class PurchaseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PurchaseInputError";
  }
}

/** The request_purchase contract shared by the REST API (M2) and the MCP tool (M3). */
export const RequestPurchaseInput = z
  .object({
    merchant_id: z.string().trim().min(1).max(40),
    items: z
      .array(z.object({ product_id: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(20) }).strict())
      .min(1)
      .max(20),
    total: z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, 'total must be a decimal string like "18.00"'),
    currency: z.string().length(3).toUpperCase(),
    reason: z.string().trim().max(500).optional(),
    idempotency_key: z.string().trim().min(8).max(100).optional(),
  })
  .strict();
export type RequestPurchaseInput = z.infer<typeof RequestPurchaseInput>;

type Purchase = typeof schema.purchases.$inferSelect;
type Agent = typeof schema.agents.$inferSelect;

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

const monthStartUtc = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** Charged and not refunded this calendar month (UTC). "processing" counts so parallel requests can't overspend. */
export async function spentThisMonthCents(userId: string, excludePurchaseId?: string) {
  const [row] = await db()
    .select({ total: sql<number>`coalesce(sum(${schema.purchases.totalCents}), 0)::int` })
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.userId, userId),
        inArray(schema.purchases.status, ["processing", "captured"]),
        gte(schema.purchases.createdAt, monthStartUtc()),
        excludePurchaseId ? sql`${schema.purchases.id} <> ${excludePurchaseId}` : undefined,
      ),
    );
  return Number(row?.total ?? 0);
}

async function hasPurchasedFrom(userId: string, merchantId: string) {
  const [row] = await db()
    .select({ id: schema.purchases.id })
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.userId, userId),
        eq(schema.purchases.merchantId, merchantId),
        inArray(schema.purchases.status, ["captured", "refunded"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Policy check + preconditions the pure checker doesn't know about (PayPal linked, policy present). */
async function evaluate(p: {
  userId: string;
  merchant: { id: string; name: string };
  items: CheckItem[];
  totalCents: number;
  claimedTotalCents: number;
  currency: string;
  humanApproved?: boolean;
  excludePurchaseId?: string;
}): Promise<{ result: CheckResult; policyId: string | null }> {
  const [policy, vault, spent, purchasedBefore] = await Promise.all([
    getActivePolicy(p.userId),
    getActiveVault(p.userId),
    spentThisMonthCents(p.userId, p.excludePurchaseId),
    hasPurchasedFrom(p.userId, p.merchant.id),
  ]);
  if (!policy) {
    const detail = "There are no active spending rules, so nothing can be bought yet.";
    return {
      policyId: null,
      result: { outcome: "blocked", reasons: [detail], checks: [{ id: "policy", label: "Spending rules", status: "block", detail }] },
    };
  }
  const result = checkPurchase({
    policy: policy.rules,
    purchase: {
      merchantId: p.merchant.id,
      merchantName: p.merchant.name,
      currency: p.currency,
      items: p.items,
      totalCents: p.totalCents,
      claimedTotalCents: p.claimedTotalCents,
    },
    context: { spentThisMonthCents: spent, hasPurchasedFromMerchant: purchasedBefore, humanApproved: p.humanApproved },
  });
  if (!vault) {
    const detail = "The owner hasn't linked PayPal yet.";
    result.checks.unshift({ id: "paypal_linked", label: "PayPal linked", status: "block", detail });
    result.outcome = "blocked";
    result.reasons = result.checks.filter((c) => c.status === "block").map((c) => c.detail);
  }
  return { result, policyId: policy.id };
}

/** Entry point for agents: validate → price from the store → deterministic rule check → act. */
export async function requestPurchase(agent: Agent, raw: unknown) {
  const input = RequestPurchaseInput.parse(raw);

  if (input.idempotency_key) {
    const [existing] = await db()
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.agentId, agent.id), eq(schema.purchases.idempotencyKey, input.idempotency_key)))
      .limit(1);
    if (existing) return existing;
  }

  const [merchant] = await db().select().from(schema.merchants).where(eq(schema.merchants.id, input.merchant_id)).limit(1);
  if (!merchant) throw new PurchaseInputError(`Unknown merchant "${input.merchant_id}". Use search_store to find products.`);

  const productIds = [...new Set(input.items.map((i) => i.product_id))];
  const products = await db()
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.merchantId, merchant.id), inArray(schema.products.id, productIds)));
  const byId = new Map(products.map((p) => [p.id, p]));
  const missing = productIds.filter((id) => !byId.has(id));
  if (missing.length) throw new PurchaseInputError(`Unknown product(s) at ${merchant.name}: ${missing.join(", ")}.`);

  // Prices and categories come from the store, never from the agent.
  const items: CheckItem[] = input.items.map((i) => {
    const p = byId.get(i.product_id)!;
    return { productId: p.id, name: p.name, category: p.category, quantity: i.quantity, unitPriceCents: p.priceCents };
  });
  const totalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

  const { result, policyId } = await evaluate({
    userId: agent.userId,
    merchant,
    items,
    totalCents,
    claimedTotalCents: toCents(input.total),
    currency: input.currency,
  });

  const status = result.outcome === "approved" ? "processing" : result.outcome;
  const id = newId("pur");
  const [purchase] = await db()
    .insert(schema.purchases)
    .values({
      id,
      userId: agent.userId,
      agentId: agent.id,
      merchantId: merchant.id,
      items,
      totalCents,
      currency: input.currency,
      reason: input.reason ?? null,
      status,
      decision: result,
      policyId,
      idempotencyKey: input.idempotency_key ?? null,
      approvalExpiresAt: status === "pending_approval" ? new Date(Date.now() + APPROVAL_TTL_MS) : null,
    })
    .onConflictDoNothing()
    .returning();

  if (!purchase) {
    // Lost an idempotency race: return the winner.
    const [winner] = await db()
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.agentId, agent.id), eq(schema.purchases.idempotencyKey, input.idempotency_key!)))
      .limit(1);
    return winner;
  }

  await logEvent(id, "requested", `${agent.name} asked to buy ${describeItems(items)} for ${formatUsd(totalCents)}.`, {
    reason: input.reason,
  });
  await logEvent(id, "rule_check", outcomeMessage(result), result);

  if (status === "processing") return chargePurchase(purchase);
  return purchase;
}

/** Charge the vaulted wallet. Caller must have moved the purchase to "processing". */
async function chargePurchase(purchase: Purchase): Promise<Purchase> {
  const [vault, user] = await Promise.all([getActiveVault(purchase.userId), getUser(purchase.userId)]);
  if (!vault) return fail(purchase, "PayPal is no longer linked.");
  try {
    const res = await chargeVaultedWallet({
      purchaseId: purchase.id,
      vaultId: vault.paymentTokenId,
      amountCents: purchase.totalCents,
      description: `Allowance agent purchase ${purchase.id}`,
      items: purchase.items.map((i) => ({ ...i })),
    });
    if (res.captureStatus !== "COMPLETED" || !res.captureId) {
      return fail(purchase, `PayPal returned capture status ${res.captureStatus ?? "unknown"}.`, res);
    }
    const holdSeconds = user?.isDemo ? env().DEMO_PAYOUT_HOLD_SECONDS : env().PAYOUT_HOLD_SECONDS;
    const now = new Date();
    const [updated] = await db()
      .update(schema.purchases)
      .set({
        status: "captured",
        paypalOrderId: res.orderId,
        paypalCaptureId: res.captureId,
        capturedAt: now,
        payoutStatus: "scheduled",
        payoutDueAt: new Date(now.getTime() + holdSeconds * 1000),
        updatedAt: now,
      })
      .where(eq(schema.purchases.id, purchase.id))
      .returning();
    await logEvent(purchase.id, "captured", `Charged ${formatUsd(purchase.totalCents)} to the saved PayPal account.`, {
      orderId: res.orderId,
      captureId: res.captureId,
    });
    await logEvent(
      purchase.id,
      "payout_scheduled",
      holdSeconds === 0
        ? "Merchant payout is ready to send."
        : `Merchant payout held for ${humanDuration(holdSeconds)} so a refund can still cancel it.`,
    );
    return updated;
  } catch (e) {
    const msg = e instanceof PayPalError ? e.message : (e as Error).message;
    return fail(purchase, `PayPal charge failed: ${msg}`, e instanceof PayPalError ? { debugId: e.debugId } : undefined);
  }
}

async function fail(purchase: Purchase, reason: string, data?: unknown) {
  const [updated] = await db()
    .update(schema.purchases)
    .set({ status: "failed", failureReason: reason, updatedAt: new Date() })
    .where(eq(schema.purchases.id, purchase.id))
    .returning();
  await logEvent(purchase.id, "failed", reason, data);
  return updated;
}

/** Human approves or declines a held purchase (dashboard now, Telegram in M4). */
export async function decidePurchase(opts: { userId: string; purchaseId: string; approve: boolean; via: string }) {
  const now = new Date();
  // Atomically claim the pending purchase: only one decision can ever win.
  const [claimed] = await db()
    .update(schema.purchases)
    .set({ status: opts.approve ? "processing" : "declined", decidedAt: now, decidedVia: opts.via, updatedAt: now })
    .where(
      and(
        eq(schema.purchases.id, opts.purchaseId),
        eq(schema.purchases.userId, opts.userId),
        eq(schema.purchases.status, "pending_approval"),
        gte(schema.purchases.approvalExpiresAt, now),
      ),
    )
    .returning();
  if (!claimed) {
    await expireStaleApprovals(opts.userId);
    const [current] = await db()
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.id, opts.purchaseId), eq(schema.purchases.userId, opts.userId)))
      .limit(1);
    if (!current) throw new PurchaseInputError("Purchase not found.");
    return current; // already decided / expired: idempotent no-op
  }

  if (!opts.approve) {
    await logEvent(claimed.id, "declined", `You declined this purchase (${opts.via}).`);
    return claimed;
  }
  await logEvent(claimed.id, "approved", `You approved this purchase (${opts.via}).`);

  // Re-check with fresh numbers: approval satisfies holds, but limits still apply.
  const [merchant] = await db().select().from(schema.merchants).where(eq(schema.merchants.id, claimed.merchantId)).limit(1);
  const { result } = await evaluate({
    userId: claimed.userId,
    merchant,
    items: claimed.items,
    totalCents: claimed.totalCents,
    claimedTotalCents: claimed.totalCents,
    currency: claimed.currency,
    humanApproved: true,
    excludePurchaseId: claimed.id,
  });
  if (result.outcome !== "approved") {
    const [blocked] = await db()
      .update(schema.purchases)
      .set({ status: "blocked", decision: result, updatedAt: new Date() })
      .where(eq(schema.purchases.id, claimed.id))
      .returning();
    await logEvent(claimed.id, "rule_check", `Re-checked after approval: ${outcomeMessage(result)}`, result);
    return blocked;
  }
  await logEvent(claimed.id, "rule_check", "Re-checked after approval: all rules pass.", result);
  return chargePurchase(claimed);
}

export async function expireStaleApprovals(userId?: string) {
  const expired = await db()
    .update(schema.purchases)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(schema.purchases.status, "pending_approval"),
        lt(schema.purchases.approvalExpiresAt, new Date()),
        userId ? eq(schema.purchases.userId, userId) : undefined,
      ),
    )
    .returning({ id: schema.purchases.id });
  for (const p of expired) await logEvent(p.id, "expired", "Nobody approved this within 24 hours, so it expired.");
}

/**
 * One-tap refund. If the merchant payout is still inside its settlement window it is cancelled;
 * if the merchant was already paid, the amount is recorded as a clawback and netted from future payouts.
 */
export async function refundPurchase(opts: { userId: string; purchaseId: string }) {
  const [purchase] = await db()
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.id, opts.purchaseId), eq(schema.purchases.userId, opts.userId)))
    .limit(1);
  if (!purchase) throw new PurchaseInputError("Purchase not found.");
  if (purchase.status === "refunded") return purchase;
  if (purchase.status !== "captured" || !purchase.paypalCaptureId) {
    throw new PurchaseInputError("Only completed purchases can be refunded.");
  }

  // Cancel the payout if it hasn't left yet (atomic: the payout worker claims with the same guard).
  const [cancelled] = await db()
    .update(schema.purchases)
    .set({ payoutStatus: "cancelled", updatedAt: new Date() })
    .where(and(eq(schema.purchases.id, purchase.id), eq(schema.purchases.payoutStatus, "scheduled")))
    .returning({ id: schema.purchases.id });

  let refund: { id: string; status: string };
  try {
    refund = await refundCapture({ purchaseId: purchase.id, captureId: purchase.paypalCaptureId });
  } catch (e) {
    if (cancelled) {
      await db()
        .update(schema.purchases)
        .set({ payoutStatus: "scheduled" })
        .where(eq(schema.purchases.id, purchase.id));
    }
    throw e;
  }

  const [updated] = await db()
    .update(schema.purchases)
    .set({ status: "refunded", paypalRefundId: refund.id, updatedAt: new Date() })
    .where(eq(schema.purchases.id, purchase.id))
    .returning();
  await logEvent(purchase.id, "refunded", `Refunded ${formatUsd(purchase.totalCents)} to the PayPal account.`, {
    refundId: refund.id,
    status: refund.status,
  });

  if (cancelled) {
    await logEvent(purchase.id, "payout_cancelled", "The merchant payout was still on hold, so it was cancelled.");
  } else if (purchase.payoutStatus !== "cancelled" && purchase.payoutStatus !== "failed") {
    const owed = purchase.payoutCents ?? purchase.totalCents;
    await db()
      .update(schema.merchants)
      .set({ clawbackCents: sql`${schema.merchants.clawbackCents} + ${owed}` })
      .where(eq(schema.merchants.id, purchase.merchantId));
    await logEvent(
      purchase.id,
      "clawback",
      `The merchant was already paid, so ${formatUsd(owed)} will be deducted from their next payouts.`,
    );
  }
  return updated;
}

/** Shape returned to agents (REST + MCP). Never includes PayPal tokens. */
export function toAgentView(p: Purchase) {
  const status =
    p.status === "captured" ? "approved" : p.status === "processing" ? "processing" : p.status;
  const message: Record<string, string> = {
    approved: `Purchase approved and paid (${formatUsd(p.totalCents)}).`,
    processing: "Payment is being processed.",
    pending_approval: "Waiting for the owner to approve. Check back with get_purchase_status.",
    blocked: "Blocked by the owner's spending rules.",
    declined: "The owner declined this purchase.",
    expired: "The owner didn't respond in time, so the request expired.",
    failed: "Payment failed. Nothing was charged.",
    refunded: "This purchase was refunded.",
  };
  return {
    purchase_id: p.id,
    status,
    message: message[status] ?? status,
    reasons: p.status === "blocked" || p.status === "pending_approval" ? p.decision.reasons : [],
    total: (p.totalCents / 100).toFixed(2),
    currency: p.currency,
    merchant_id: p.merchantId,
    items: p.items.map((i) => ({ product_id: i.productId, name: i.name, quantity: i.quantity })),
    approval_expires_at: p.status === "pending_approval" ? p.approvalExpiresAt?.toISOString() : undefined,
    created_at: p.createdAt.toISOString(),
  };
}

function outcomeMessage(r: CheckResult) {
  if (r.outcome === "approved") return "All rules pass.";
  if (r.outcome === "pending_approval") return `Needs your approval: ${r.reasons.join(" ")}`;
  return `Blocked: ${r.reasons.join(" ")}`;
}

function describeItems(items: CheckItem[]) {
  return items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(", ");
}

function humanDuration(s: number) {
  if (s < 60) return `${s} seconds`;
  if (s < 3600) return `${Math.round(s / 60)} minutes`;
  return `${Math.round(s / 3600)} hours`;
}
