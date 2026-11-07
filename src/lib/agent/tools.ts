import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { grantState, listGrants } from "@/lib/allowances";
import { RequestPurchaseInput, requestPurchase, spentThisMonthCents, toAgentView } from "@/lib/purchases/service";
import { rateLimit } from "@/lib/rate-limit";
import { getActivePolicy, getActiveVault } from "@/lib/users";

/**
 * The four agent tools, shared by the MCP server (/api/mcp) and the built-in chat agent (/agent).
 * Each returns structured data plus one plain sentence for humans and LLMs.
 * Money decisions happen only inside requestPurchase → deterministic checker.
 */

type Agent = typeof schema.agents.$inferSelect;
export type ToolResult<T> = { summary: string; data: T };

export const SearchStoreInput = z
  .object({
    query: z.string().trim().max(100).describe('What to look for, e.g. "coffee beans" or "Pragmatic Programmer". Empty lists everything.'),
    category: z.string().trim().toLowerCase().max(40).optional().describe('Optional category filter, e.g. "coffee" or "books".'),
  })
  .strict();

export async function searchStore(agent: Agent, input: z.infer<typeof SearchStoreInput>) {
  await rateLimit(`agent:${agent.id}:search`, 60, 60, "searches");
  const tokens = input.query.toLowerCase().split(/\s+/).filter((t) => t.length > 1).slice(0, 6);
  const haystack = sql`lower(${schema.products.name} || ' ' || coalesce(${schema.products.description}, '') || ' ' || ${schema.products.category} || ' ' || ${schema.merchants.name})`;
  const score = tokens.length
    ? sql<number>`(${sql.join(tokens.map((t) => sql`(case when ${haystack} like ${"%" + t.replace(/s$/, "") + "%"} then 1 else 0 end)`), sql` + `)})`
    : sql<number>`1`;
  const rows = await db()
    .select({
      product_id: schema.products.id,
      merchant_id: schema.products.merchantId,
      merchant_name: schema.merchants.name,
      name: schema.products.name,
      description: schema.products.description,
      category: schema.products.category,
      priceCents: schema.products.priceCents,
      score,
    })
    .from(schema.products)
    .innerJoin(schema.merchants, eq(schema.products.merchantId, schema.merchants.id))
    .where(and(input.category ? eq(schema.products.category, input.category) : undefined, sql`${score} > 0`))
    .orderBy(desc(score), schema.products.priceCents)
    .limit(10);
  const products = rows.map((r) => ({
    product_id: r.product_id,
    merchant_id: r.merchant_id,
    merchant_name: r.merchant_name,
    name: r.name,
    description: r.description,
    category: r.category,
    price: (r.priceCents / 100).toFixed(2),
    currency: "USD",
  }));
  return {
    summary: products.length
      ? `Found ${products.length} product(s): ${products.map((p) => `${p.name} (${formatUsd(Math.round(Number(p.price) * 100))}, ${p.merchant_name})`).join("; ")}.`
      : "No matching products. Try a broader query or an empty query to list everything.",
    data: { products },
  } satisfies ToolResult<unknown>;
}

export async function allowanceStatus(agent: Agent) {
  const [policy, vault, spent, pending, grants] = await Promise.all([
    getActivePolicy(agent.userId),
    getActiveVault(agent.userId),
    spentThisMonthCents(agent.userId),
    db()
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.purchases)
      .where(and(eq(schema.purchases.userId, agent.userId), eq(schema.purchases.status, "pending_approval"))),
    listGrants(agent.userId),
  ]);
  const active = grants.filter((g) => grantState(g) === "active");
  const r = policy?.rules;
  const remaining = r ? Math.max(0, r.monthlyLimitCents - spent) : 0;
  const data = {
    agent_name: agent.name,
    paypal_linked: Boolean(vault),
    currency: "USD",
    monthly_limit: r ? (r.monthlyLimitCents / 100).toFixed(2) : null,
    spent_this_month: (spent / 100).toFixed(2),
    remaining_this_month: (remaining / 100).toFixed(2),
    per_order_limit: r?.perOrderLimitCents != null ? (r.perOrderLimitCents / 100).toFixed(2) : null,
    approval_required_above: r?.approvalThresholdCents != null ? (r.approvalThresholdCents / 100).toFixed(2) : null,
    allowed_categories: r?.allowedCategories.length ? r.allowedCategories : "any",
    blocked_categories: r?.blockedCategories ?? [],
    new_merchants_need_approval: r?.requireApprovalForNewMerchants ?? false,
    pending_approvals: pending[0]?.n ?? 0,
    pace_limit: r?.velocity ? `ask after ${r.velocity.maxPurchases} purchases in ${r.velocity.windowMinutes} minutes` : null,
    repeat_purchases_need_approval_within_days: r?.duplicateWindowDays ?? null,
    // Single-use permissions the owner granted for a specific task (they cover one matching purchase).
    one_time_allowances: active.map((g) => ({
      for: g.description,
      max_total: (g.amountCents / 100).toFixed(2),
      category: g.category ?? "any",
      merchant_id: g.merchantId ?? "any",
      expires_at: g.expiresAt.toISOString(),
    })),
  };
  const summary = !r
    ? "The owner hasn't set spending rules yet, so nothing can be bought."
    : !vault
      ? "The owner hasn't linked PayPal yet, so purchases will be blocked."
      : `${formatUsd(remaining)} of ${formatUsd(r.monthlyLimitCents)} left this month. ` +
        (r.allowedCategories.length ? `Only ${r.allowedCategories.join(", ")}. ` : "") +
        (r.perOrderLimitCents != null ? `Max ${formatUsd(r.perOrderLimitCents)} per order. ` : "") +
        (r.approvalThresholdCents != null ? `Orders over ${formatUsd(r.approvalThresholdCents)} need the owner's approval.` : "") +
        (active.length
          ? ` One-time allowance${active.length > 1 ? "s" : ""}: ${active.map((g) => `"${g.description}" (one purchase up to ${formatUsd(g.amountCents)}${g.category ? `, ${g.category}` : ""}, until ${g.expiresAt.toISOString().slice(0, 10)})`).join("; ")}. A matching purchase goes through even if it's outside the usual categories or limits.`
          : "");
  return { summary: summary.trim(), data } satisfies ToolResult<unknown>;
}

export { RequestPurchaseInput };

export async function requestPurchaseTool(agent: Agent, input: unknown) {
  await rateLimit(`agent:${agent.id}:purchase`, 10, 60, "purchase requests");
  const p = await requestPurchase(agent, input);
  const view = toAgentView(p);
  const why = view.reasons.map((r) => r.replace(/\.$/, "")).join("; ");
  const summary =
    view.status === "approved"
      ? `Approved and paid: ${formatUsd(p.totalCents)} at ${p.merchantId}. Purchase ${p.id}.${view.receipt_id ? ` Signed receipt ${view.receipt_id} (AP2-style JWS) is in "receipt"; anyone can verify it with /.well-known/jwks.json.` : ""}`
      : view.status === "pending_approval"
        ? `Held for the owner's approval (${why}). Tell the user it's waiting for their OK, then call get_purchase_status with purchase_id "${p.id}" to check back. Do not retry the purchase.`
        : view.status === "blocked"
          ? `Blocked by the owner's rules: ${why}. Do not retry the same purchase; tell the user why.`
          : view.message;
  return { summary, data: view } satisfies ToolResult<unknown>;
}

export const PurchaseStatusInput = z
  .object({ purchase_id: z.string().trim().min(5).max(40).describe('The purchase_id returned by request_purchase, e.g. "pur_abc123".') })
  .strict();

export async function purchaseStatus(agent: Agent, input: z.infer<typeof PurchaseStatusInput>) {
  await rateLimit(`agent:${agent.id}:status`, 60, 60, "status checks");
  const [p] = await db()
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.id, input.purchase_id), eq(schema.purchases.agentId, agent.id)))
    .limit(1);
  if (!p) return { summary: `No purchase ${input.purchase_id} for this agent.`, data: null };
  const view = toAgentView(p);
  const summary =
    view.status === "pending_approval" ? `Still waiting for the owner's approval. Check again later.` : view.message;
  return { summary, data: view } satisfies ToolResult<unknown>;
}

/** Tool descriptions written for an LLM: when to use, what comes back, what not to do. */
export const TOOL_DESCRIPTIONS = {
  search_store:
    "Search the Allowance demo store (coffee, books and more) for products you can buy. Returns product_id, merchant_id, name, category and price (USD). Always search first: request_purchase needs the exact product_id and merchant_id from here.",
  get_allowance_status:
    "Check how much the owner lets you spend: remaining monthly budget, per-order limit, the amount above which the owner must approve, allowed categories, and whether PayPal is linked. Call this before planning purchases.",
  request_purchase:
    'Ask to buy items from ONE merchant. The owner\'s rules are enforced by a deterministic checker, not by you: the result is "approved" (already paid via the owner\'s PayPal; the result includes a signed receipt, an AP2-style JWS, you can pass to the merchant), "pending_approval" (the owner was asked; tell the user and poll get_purchase_status, never retry), or "blocked" (explain the reason to the user; don\'t retry). Pass total as a decimal string matching the store prices exactly, and a short reason the owner will see. Always pass a unique idempotency_key per intended purchase so retries never double-charge.',
  get_purchase_status:
    'Check a purchase by purchase_id, e.g. to see whether the owner approved a "pending_approval" request. Statuses: approved, pending_approval, blocked, declined, expired, failed, refunded.',
} as const;
