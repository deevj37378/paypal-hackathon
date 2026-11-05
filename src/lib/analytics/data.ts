import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { STORE_MERCHANTS } from "@/lib/store/catalog";

/**
 * Rows for the merchant analytics dashboard (/store/analytics, AG Studio). Public page, so no buyer
 * identities: purchases are anonymous and agents are grouped by type, not by user-chosen names.
 */

export type PurchaseRow = {
  id: string;
  date: string; // YYYY-MM-DD (UTC)
  createdAt: string; // ISO
  merchant: string;
  agentType: string;
  outcome: string; // what the deterministic checker decided, incl. the human step
  ruleDecision: string; // approved | held | blocked (checker only)
  blockReason: string | null; // the first rule that blocked it
  holdReason: string | null;
  category: string; // main category of the order
  itemCount: number;
  total: number;
  charged: number; // amount actually charged (0 if never charged)
  isCharged: boolean;
  isRefunded: boolean;
  refunded: number;
  payoutStatus: string;
  isPaidOut: boolean;
  paidOut: number;
  isDemo: boolean;
};

export type ItemRow = { id: string; purchaseId: string; product: string; category: string; quantity: number; amount: number };
export type MerchantRow = { id: string; name: string; clawbackOutstanding: number };
export type AnalyticsData = { purchases: PurchaseRow[]; items: ItemRow[]; merchants: MerchantRow[]; asOf: string };

const agentType = (name: string | null, keyPrefix: string | null) => {
  if (keyPrefix === "builtin") return "Built-in assistant";
  if (!name) return "Deleted agent";
  if (/claude/i.test(name)) return "Claude (MCP)";
  if (/chatgpt|openai|gpt/i.test(name)) return "ChatGPT";
  if (/smoke|test|inspector|race|wh agent/i.test(name)) return "Test agent";
  return "Other MCP / REST agent";
};

const OUTCOME: Record<string, string> = {
  captured: "Charged",
  refunded: "Charged, then refunded",
  pending_approval: "Waiting for approval",
  declined: "Declined by owner",
  expired: "Approval expired",
  blocked: "Blocked by rules",
  failed: "Payment failed",
  processing: "Processing",
};

export async function getAnalyticsData(): Promise<AnalyticsData> {
  const rows = await db()
    .select({ p: schema.purchases, agentName: schema.agents.name, keyPrefix: schema.agents.keyPrefix, merchantName: schema.merchants.name, isDemo: schema.users.isDemo })
    .from(schema.purchases)
    .leftJoin(schema.agents, eq(schema.purchases.agentId, schema.agents.id))
    .innerJoin(schema.merchants, eq(schema.purchases.merchantId, schema.merchants.id))
    .innerJoin(schema.users, eq(schema.purchases.userId, schema.users.id))
    .where(and(inArray(schema.purchases.merchantId, STORE_MERCHANTS)));
  const merchants = await db().select().from(schema.merchants).where(inArray(schema.merchants.id, STORE_MERCHANTS));

  const purchases: PurchaseRow[] = [];
  const items: ItemRow[] = [];
  for (const { p, agentName, keyPrefix, merchantName, isDemo } of rows) {
    const type = agentType(agentName, keyPrefix);
    if (type === "Test agent") continue;
    const blocked = p.decision.checks.find((c) => c.status === "block");
    const held = p.decision.checks.find((c) => c.status === "hold");
    const isCharged = p.status === "captured" || p.status === "refunded";
    // Approved by the checker outright vs. after a human said yes.
    const outcome =
      p.status === "captured" && p.decision.outcome === "pending_approval"
        ? "Charged after approval"
        : p.status === "refunded" && p.decision.outcome === "pending_approval"
          ? "Charged after approval, then refunded"
          : (OUTCOME[p.status] ?? p.status);
    const main = [...p.items].sort((a, b) => b.unitPriceCents * b.quantity - a.unitPriceCents * a.quantity)[0];
    purchases.push({
      id: p.id,
      date: p.createdAt.toISOString().slice(0, 10),
      createdAt: p.createdAt.toISOString(),
      merchant: merchantName,
      agentType: type,
      outcome,
      ruleDecision: p.decision.outcome === "approved" ? "Approved by rules" : p.decision.outcome === "pending_approval" ? "Held for approval" : "Blocked by rules",
      blockReason: blocked?.label ?? null,
      holdReason: held?.label ?? null,
      category: main?.category ?? "unknown",
      itemCount: p.items.reduce((s, i) => s + i.quantity, 0),
      total: p.totalCents / 100,
      charged: isCharged ? p.totalCents / 100 : 0,
      isCharged,
      isRefunded: p.status === "refunded",
      refunded: p.status === "refunded" ? p.totalCents / 100 : 0,
      payoutStatus: p.payoutStatus === "none" ? "Not charged" : p.payoutStatus === "paid" ? "Paid out" : p.payoutStatus === "cancelled" ? "Cancelled (refund)" : p.payoutStatus === "failed" ? "Failed" : "In refund window",
      isPaidOut: p.payoutStatus === "paid",
      paidOut: p.payoutStatus === "paid" ? (p.payoutCents ?? p.totalCents) / 100 : 0,
      isDemo: Boolean(isDemo),
    });
    for (const i of p.items) {
      items.push({ id: `${p.id}:${i.productId}`, purchaseId: p.id, product: i.name, category: i.category, quantity: i.quantity, amount: (i.unitPriceCents * i.quantity) / 100 });
    }
  }
  return {
    purchases,
    items,
    merchants: merchants.map((m) => ({ id: m.id, name: m.name, clawbackOutstanding: m.clawbackCents / 100 })),
    asOf: new Date().toISOString(),
  };
}
