import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { type DbExecutor, withUserLock } from "@/db/tx";
import { env } from "@/lib/env";
import { newId } from "@/lib/ids";
import { formatUsd, toCents } from "@/lib/money";
import { PayPalError } from "@/lib/paypal/client";
import { chargeVaultedWallet, refundCapture } from "@/lib/paypal/payments";
import { checkPurchase, type CheckItem, type CheckResult } from "@/lib/policy/check";
import { getActivePolicy, getActiveVault, getUser } from "@/lib/users";
import { issueReceipt } from "@/lib/mandates/receipts";
import { receiptIdFor } from "@/lib/mandates/mandate";
import { claimGrant, findMatchingGrant, releaseGrant } from "@/lib/allowances";
import { logEvent } from "./events";
import { notifyPurchase } from "./notify";

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
    // Accept "18.00" or 18 / 18.5 (LLM clients vary); always normalised to a 2-decimal string.
    total: z
      .union([z.string(), z.number().nonnegative().max(999_999)])
      .transform((v) => (typeof v === "number" ? (Math.round(v * 100) / 100).toFixed(2) : v.trim()))
      .pipe(z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, 'total must be a decimal amount like "18.00"')),
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
export async function spentThisMonthCents(userId: string, excludePurchaseId?: string, ex: DbExecutor = db()) {
  const [row] = await ex
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

async function hasPurchasedFrom(userId: string, merchantId: string, ex: DbExecutor) {
  const [row] = await ex
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

/** Purchases that moved money in the last `minutes` (pace limit). */
async function recentPurchaseCount(userId: string, minutes: number, excludePurchaseId: string | undefined, ex: DbExecutor) {
  const [row] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.userId, userId),
        inArray(schema.purchases.status, ["processing", "captured", "refunded"]),
        gte(schema.purchases.createdAt, new Date(Date.now() - minutes * 60_000)),
        excludePurchaseId ? sql`${schema.purchases.id} <> ${excludePurchaseId}` : undefined,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Latest charge (not refunded) of each product in the order within `days` (duplicate check). */
async function lastBoughtAt(userId: string, productIds: string[], days: number, excludePurchaseId: string | undefined, ex: DbExecutor) {
  const rows = await ex
    .select({ items: schema.purchases.items, at: schema.purchases.createdAt })
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.userId, userId),
        inArray(schema.purchases.status, ["processing", "captured"]),
        gte(schema.purchases.createdAt, new Date(Date.now() - days * 86_400_000)),
        excludePurchaseId ? sql`${schema.purchases.id} <> ${excludePurchaseId}` : undefined,
      ),
    );
  const out: Record<string, Date> = {};
  for (const r of rows) {
    for (const i of r.items) {
      if (productIds.includes(i.productId) && (!out[i.productId] || out[i.productId] < r.at)) out[i.productId] = r.at;
    }
  }
  return out;
}

/** Policy check + preconditions the pure checker doesn't know about (PayPal linked, policy present). */
async function evaluate(ex: DbExecutor, p: {
  userId: string;
  merchant: { id: string; name: string };
  items: CheckItem[];
  totalCents: number;
  claimedTotalCents: number;
  currency: string;
  humanApproved?: boolean;
  excludePurchaseId?: string;
  /** Only new requests can use a one-time allowance (not re-checks after approval). */
  allowGrant?: boolean;
}): Promise<{ result: CheckResult; policyId: string | null; grantId: string | null }> {
  const [policy, vault, spent, purchasedBefore] = await Promise.all([
    getActivePolicy(p.userId, ex),
    getActiveVault(p.userId, ex),
    spentThisMonthCents(p.userId, p.excludePurchaseId, ex),
    hasPurchasedFrom(p.userId, p.merchant.id, ex),
  ]);
  if (!policy) {
    const detail = "There are no active spending rules, so nothing can be bought yet.";
    return {
      policyId: null,
      grantId: null,
      result: { outcome: "blocked", reasons: [detail], checks: [{ id: "policy", label: "Spending rules", status: "block", detail }] },
    };
  }
  const rules = policy.rules;
  const [recent, lastBought, grant] = await Promise.all([
    rules.velocity ? recentPurchaseCount(p.userId, rules.velocity.windowMinutes, p.excludePurchaseId, ex) : Promise.resolve(0),
    rules.duplicateWindowDays !== null
      ? lastBoughtAt(p.userId, p.items.map((i) => i.productId), rules.duplicateWindowDays, p.excludePurchaseId, ex)
      : Promise.resolve({}),
    p.allowGrant ? findMatchingGrant(ex, p.userId, { merchantId: p.merchant.id, items: p.items, totalCents: p.totalCents }) : Promise.resolve(null),
  ]);
  const result = checkPurchase({
    policy: rules,
    purchase: {
      merchantId: p.merchant.id,
      merchantName: p.merchant.name,
      currency: p.currency,
      items: p.items,
      totalCents: p.totalCents,
      claimedTotalCents: p.claimedTotalCents,
    },
    context: {
      spentThisMonthCents: spent,
      hasPurchasedFromMerchant: purchasedBefore,
      humanApproved: p.humanApproved,
      recentPurchaseCount: recent,
      lastBoughtAt: lastBought,
      grant: grant ? { id: grant.id, description: grant.description, amountCents: grant.amountCents } : undefined,
    },
  });
  if (!vault) {
    const detail = "The owner hasn't linked PayPal yet.";
    result.checks.unshift({ id: "paypal_linked", label: "PayPal linked", status: "block", detail });
    result.outcome = "blocked";
    result.reasons = result.checks.filter((c) => c.status === "block").map((c) => c.detail);
  }
  return { result, policyId: policy.id, grantId: grant && result.outcome === "approved" ? grant.id : null };
}

/** Entry point for agents: validate → price from the store → atomic rule check + reserve → charge. */
export async function requestPurchase(agent: Agent, raw: unknown) {
  const input = RequestPurchaseInput.parse(raw);
  const existing = await findByIdempotencyKey(db(), agent.id, input.idempotency_key);
  if (existing) return existing;

  const order = await resolveOrder(input);
  const { purchase, created } = await reservePurchase(agent, input, order);
  if (!created) return purchase;

  await logEvent(purchase.id, "requested", `${agent.name} asked to buy ${describeItems(order.items)} for ${formatUsd(order.totalCents)}.`, {
    reason: input.reason,
  });
  await logEvent(purchase.id, "rule_check", outcomeMessage(purchase.decision), purchase.decision);
  await notifyPurchase(purchase, agent.name);

  if (purchase.status === "processing") {
    const charged = await chargePurchase(purchase);
    await notifyPurchase(charged, agent.name);
    return charged;
  }
  return purchase;
}

async function findByIdempotencyKey(ex: DbExecutor, agentId: string, key: string | undefined) {
  if (!key) return null;
  const [p] = await ex
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.agentId, agentId), eq(schema.purchases.idempotencyKey, key)))
    .limit(1);
  return p ?? null;
}

type ResolvedOrder = { merchant: { id: string; name: string }; items: CheckItem[]; totalCents: number };

/** Prices and categories come from the store, never from the agent. */
async function resolveOrder(input: RequestPurchaseInput): Promise<ResolvedOrder> {
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

  const items: CheckItem[] = input.items.map((i) => {
    const p = byId.get(i.product_id)!;
    return { productId: p.id, name: p.name, category: p.category, quantity: i.quantity, unitPriceCents: p.priceCents };
  });
  return { merchant: { id: merchant.id, name: merchant.name }, items, totalCents: items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0) };
}

/**
 * Atomic check-and-reserve. Under a per-user lock: read this month's spend (which counts
 * "processing" reservations), run the pure checker, and insert the purchase. An approved
 * purchase is inserted as "processing", so the next locked request already counts it.
 * Exported for the concurrency test.
 */
export async function reservePurchase(agent: Agent, input: RequestPurchaseInput, order: ResolvedOrder) {
  return withUserLock(agent.userId, async (tx) => {
    const existing = await findByIdempotencyKey(tx, agent.id, input.idempotency_key);
    if (existing) return { purchase: existing, created: false };

    const { result, policyId, grantId } = await evaluate(tx, {
      allowGrant: true,
      userId: agent.userId,
      merchant: order.merchant,
      items: order.items,
      totalCents: order.totalCents,
      claimedTotalCents: toCents(input.total),
      currency: input.currency,
    });
    const status = result.outcome === "approved" ? "processing" : result.outcome;
    const id = newId("pur");
    if (grantId && !(await claimGrant(tx, grantId, id))) throw new Error("One-time allowance was claimed concurrently");
    const [purchase] = await tx
      .insert(schema.purchases)
      .values({
        id,
        grantId,
        userId: agent.userId,
        agentId: agent.id,
        merchantId: order.merchant.id,
        items: order.items,
        totalCents: order.totalCents,
        currency: input.currency,
        reason: input.reason ?? null,
        status,
        decision: result,
        policyId,
        idempotencyKey: input.idempotency_key ?? null,
        approvalExpiresAt: status === "pending_approval" ? new Date(Date.now() + APPROVAL_TTL_MS) : null,
      })
      .returning();
    return { purchase, created: true };
  });
}

/** Charge the vaulted wallet. Caller must have moved the purchase to "processing". */
async function chargePurchase(purchase: Purchase): Promise<Purchase> {
  const vault = await getActiveVault(purchase.userId);
  if (!vault) return fail(purchase, "PayPal is no longer linked.");
  try {
    const res = await chargeVaultedWallet({
      purchaseId: purchase.id,
      vaultId: vault.paymentTokenId,
      amountCents: purchase.totalCents,
      description: `Allowance agent purchase ${purchase.id} · receipt ${receiptIdFor(purchase.id)}`,
      items: purchase.items.map((i) => ({ ...i })),
    });
    if (res.captureStatus !== "COMPLETED" || !res.captureId) {
      return fail(purchase, `PayPal returned capture status ${res.captureStatus ?? "unknown"}.`, res);
    }
    return (await markCaptured(purchase.id, { orderId: res.orderId, captureId: res.captureId }, "Charged")) ?? purchase;
  } catch (e) {
    // A definitive PayPal rejection (4xx, e.g. INSTRUMENT_DECLINED) means nothing was charged.
    if (e instanceof PayPalError && e.status >= 400 && e.status < 500) {
      return fail(purchase, `PayPal declined the charge: ${e.message}`, { debugId: e.debugId });
    }
    // Network error / 5xx after retries: the charge may or may not have happened. Stay "processing";
    // the PAYMENT.CAPTURE.* webhook (custom_id = purchase id) settles it, or the sweeper fails it later.
    await logEvent(purchase.id, "awaiting_confirmation", "No clear answer from PayPal yet; waiting for PayPal to confirm.", {
      error: e instanceof PayPalError ? { message: e.message, debugId: e.debugId } : String(e),
    });
    const [current] = await db().select().from(schema.purchases).where(eq(schema.purchases.id, purchase.id)).limit(1);
    return current;
  }
}

/**
 * Record a completed capture and schedule the merchant payout (settlement window).
 * Idempotent: only moves processing/failed purchases without a capture. Used by the charge path and the webhook.
 */
export async function markCaptured(purchaseId: string, ids: { orderId?: string | null; captureId: string }, how: "Charged" | "PayPal confirmed") {
  const [p] = await db().select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId)).limit(1);
  if (!p) return null;
  const user = await getUser(p.userId);
  const holdSeconds = user?.isDemo ? env().DEMO_PAYOUT_HOLD_SECONDS : env().PAYOUT_HOLD_SECONDS;
  const now = new Date();
  const [updated] = await db()
    .update(schema.purchases)
    .set({
      status: "captured",
      paypalOrderId: ids.orderId ?? p.paypalOrderId,
      paypalCaptureId: ids.captureId,
      capturedAt: now,
      failureReason: null,
      payoutStatus: "scheduled",
      payoutDueAt: new Date(now.getTime() + holdSeconds * 1000),
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.purchases.id, purchaseId),
        inArray(schema.purchases.status, ["processing", "failed"]),
        sql`${schema.purchases.paypalCaptureId} is null`,
      ),
    )
    .returning();
  if (!updated) return p; // already captured (or refunded): nothing to do
  const receipt = await issueReceipt(purchaseId);
  await logEvent(purchaseId, "captured", `${how} ${formatUsd(p.totalCents)} to the saved PayPal account.`, ids);
  await logEvent(
    purchaseId,
    "payout_scheduled",
    holdSeconds === 0
      ? "Merchant payout is ready to send."
      : `Merchant payout held for ${humanDuration(holdSeconds)} so a refund can still cancel it.`,
  );
  return receipt ? { ...updated, receiptId: receiptIdFor(purchaseId), receiptJws: receipt } : updated;
}

async function fail(purchase: Purchase, reason: string, data?: unknown) {
  if (purchase.grantId) await releaseGrant(purchase.id); // nothing was charged: the one-time allowance is free again
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
    await notifyPurchase(claimed);
    return claimed;
  }
  await logEvent(claimed.id, "approved", `You approved this purchase (${opts.via}).`);

  // Re-check with fresh numbers under the user's lock: approval satisfies holds, but limits still apply.
  const [merchant] = await db().select().from(schema.merchants).where(eq(schema.merchants.id, claimed.merchantId)).limit(1);
  const recheck = await withUserLock(claimed.userId, async (tx) => {
    const { result } = await evaluate(tx, {
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
      const [blocked] = await tx
        .update(schema.purchases)
        .set({ status: "blocked", decision: result, updatedAt: new Date() })
        .where(eq(schema.purchases.id, claimed.id))
        .returning();
      return { result, blocked };
    }
    return { result, blocked: null };
  });
  if (recheck.blocked) {
    await logEvent(claimed.id, "rule_check", `Re-checked after approval: ${outcomeMessage(recheck.result)}`, recheck.result);
    await notifyPurchase(recheck.blocked);
    return recheck.blocked;
  }
  await logEvent(claimed.id, "rule_check", "Re-checked after approval: all rules pass.", recheck.result);
  const charged = await chargePurchase(claimed);
  await notifyPurchase(charged);
  return charged;
}

/** Purchases stuck in "processing" with no PayPal confirmation after 15 minutes are failed (nothing captured). */
export async function failStaleProcessing() {
  const stale = await db()
    .update(schema.purchases)
    .set({ status: "failed", failureReason: "PayPal never confirmed the charge.", updatedAt: new Date() })
    .where(
      and(
        eq(schema.purchases.status, "processing"),
        sql`${schema.purchases.paypalCaptureId} is null`,
        lt(schema.purchases.updatedAt, new Date(Date.now() - 15 * 60_000)),
      ),
    )
    .returning();
  for (const p of stale) {
    await logEvent(p.id, "failed", "PayPal never confirmed the charge, so it was marked failed. If PayPal confirms later, it's corrected automatically.");
    await notifyPurchase(p);
  }
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
    .returning();
  for (const p of expired) {
    await logEvent(p.id, "expired", "Nobody approved this within 24 hours, so it expired.");
    await notifyPurchase(p);
  }
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
    pending_approval:
      "Held for the owner's approval. Tell them to tap Approve or Decline on their Allowance dashboard (or in Telegram, if they connected it). Nothing is charged until they approve; unanswered requests expire after 24 hours. Check back with get_purchase_status.",
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
    // AP2-style signed purchase receipt (compact JWS, ES256). Verify with /.well-known/jwks.json.
    receipt_id: p.receiptId ?? undefined,
    receipt: p.receiptJws ?? undefined,
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

/**
 * A refund that happened outside Allowance (e.g. in the PayPal dashboard), reported by webhook.
 * Same settlement rules as refundPurchase: cancel a held payout, otherwise record a clawback.
 */
export async function recordExternalRefund(captureId: string, refundId: string) {
  const [p] = await db().select().from(schema.purchases).where(eq(schema.purchases.paypalCaptureId, captureId)).limit(1);
  if (!p || p.status !== "captured") return p ?? null; // unknown, or already refunded by us
  const [cancelled] = await db()
    .update(schema.purchases)
    .set({ payoutStatus: "cancelled", updatedAt: new Date() })
    .where(and(eq(schema.purchases.id, p.id), eq(schema.purchases.payoutStatus, "scheduled")))
    .returning({ id: schema.purchases.id });
  const [updated] = await db()
    .update(schema.purchases)
    .set({ status: "refunded", paypalRefundId: refundId, updatedAt: new Date() })
    .where(and(eq(schema.purchases.id, p.id), eq(schema.purchases.status, "captured")))
    .returning();
  if (!updated) return p;
  await logEvent(p.id, "refunded", `PayPal reports a refund of ${formatUsd(p.totalCents)} made outside Allowance.`, { refundId });
  if (cancelled) {
    await logEvent(p.id, "payout_cancelled", "The merchant payout was still on hold, so it was cancelled.");
  } else if (p.payoutStatus !== "cancelled" && p.payoutStatus !== "failed") {
    const owed = p.payoutCents ?? p.totalCents;
    await db()
      .update(schema.merchants)
      .set({ clawbackCents: sql`${schema.merchants.clawbackCents} + ${owed}` })
      .where(eq(schema.merchants.id, p.merchantId));
    await logEvent(p.id, "clawback", `The merchant was already paid, so ${formatUsd(owed)} will be deducted from their next payouts.`);
  }
  return updated;
}
