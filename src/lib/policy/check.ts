import { formatUsd } from "@/lib/money";
import type { PolicyRules } from "./schema";

/**
 * Deterministic policy checker. NO LLM here: this function alone decides whether money moves.
 * Pure: same input → same output; unit tested in check.test.ts.
 */

export type CheckItem = { productId: string; name: string; category: string; quantity: number; unitPriceCents: number };

export type CheckInput = {
  policy: PolicyRules;
  purchase: {
    merchantId: string;
    merchantName: string;
    currency: string;
    items: CheckItem[];
    totalCents: number;
    /** Total the agent claimed; must match the server-computed total. */
    claimedTotalCents: number;
  };
  context: {
    /** Already charged (not refunded) this calendar month, excluding this purchase. */
    spentThisMonthCents: number;
    /** True if the user has a previous successful purchase from this merchant. */
    hasPurchasedFromMerchant: boolean;
    /** Set when re-checking after a human approved: approval-type holds are satisfied. */
    humanApproved?: boolean;
    /** Purchases that moved money (processing/charged/refunded) in the pace window, excluding this one. */
    recentPurchaseCount?: number;
    /** When each product in this order was last charged (not refunded), within the duplicate window. */
    lastBoughtAt?: Record<string, Date>;
    /** Clock for "2 days ago" wording; defaults to now. */
    now?: Date;
  };
};

export type CheckStatus = "pass" | "hold" | "block";
export type Check = { id: string; label: string; status: CheckStatus; detail: string };
export type Outcome = "approved" | "pending_approval" | "blocked";
export type CheckResult = { outcome: Outcome; checks: Check[]; reasons: string[] };

export function checkPurchase({ policy, purchase, context }: CheckInput): CheckResult {
  const checks: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ id, label, status, detail });

  // 1. Basic integrity
  if (purchase.items.length === 0 || purchase.totalCents <= 0) {
    add("integrity", "Valid order", "block", "The order has no items or a zero total.");
  } else if (purchase.claimedTotalCents !== purchase.totalCents) {
    add(
      "integrity",
      "Valid order",
      "block",
      `The agent's total (${formatUsd(purchase.claimedTotalCents)}) doesn't match the store's price (${formatUsd(purchase.totalCents)}).`,
    );
  } else {
    add("integrity", "Valid order", "pass", `${purchase.items.length} item(s), ${formatUsd(purchase.totalCents)}.`);
  }

  // 2. Currency
  if (purchase.currency !== policy.currency) {
    add("currency", "Currency", "block", `Only ${policy.currency} purchases are allowed (got ${purchase.currency}).`);
  } else {
    add("currency", "Currency", "pass", policy.currency);
  }

  // 3. Merchant block list
  if (policy.blockedMerchants.includes(purchase.merchantId)) {
    add("merchant_blocked", "Merchant allowed", "block", `${purchase.merchantName} is on your blocked list.`);
  } else {
    add("merchant_blocked", "Merchant allowed", "pass", `${purchase.merchantName} isn't blocked.`);
  }

  // 4. Categories
  const blockedCats = unique(purchase.items.filter((i) => policy.blockedCategories.includes(i.category)).map((i) => i.category));
  const notAllowed =
    policy.allowedCategories.length === 0
      ? []
      : unique(purchase.items.filter((i) => !policy.allowedCategories.includes(i.category)).map((i) => i.category));
  if (blockedCats.length > 0) {
    add("categories", "Categories", "block", `You never allow ${list(blockedCats)}.`);
  } else if (notAllowed.length > 0) {
    add(
      "categories",
      "Categories",
      "block",
      `${capitalize(list(notAllowed))} isn't in your allowed categories (${list(policy.allowedCategories)}).`,
    );
  } else {
    add("categories", "Categories", "pass", `All items are ${list(unique(purchase.items.map((i) => i.category)))}.`);
  }

  // 5. Per-order cap
  if (policy.perOrderLimitCents !== null && purchase.totalCents > policy.perOrderLimitCents) {
    add(
      "per_order_limit",
      "Per-order limit",
      "block",
      `${formatUsd(purchase.totalCents)} is over your ${formatUsd(policy.perOrderLimitCents)} per-order limit.`,
    );
  } else if (policy.perOrderLimitCents !== null) {
    add("per_order_limit", "Per-order limit", "pass", `Within ${formatUsd(policy.perOrderLimitCents)}.`);
  }

  // 6. Monthly limit (enforced even after human approval)
  const after = context.spentThisMonthCents + purchase.totalCents;
  const left = Math.max(0, policy.monthlyLimitCents - context.spentThisMonthCents);
  if (after > policy.monthlyLimitCents) {
    add(
      "monthly_limit",
      "Monthly limit",
      "block",
      `Only ${formatUsd(left)} of your ${formatUsd(policy.monthlyLimitCents)} monthly allowance is left.`,
    );
  } else {
    add(
      "monthly_limit",
      "Monthly limit",
      "pass",
      `${formatUsd(after)} of ${formatUsd(policy.monthlyLimitCents)} used after this order.`,
    );
  }

  // 7. Approval threshold (hold, not block)
  if (policy.approvalThresholdCents !== null && purchase.totalCents > policy.approvalThresholdCents) {
    add(
      "approval_threshold",
      "Approval threshold",
      context.humanApproved ? "pass" : "hold",
      context.humanApproved
        ? "You approved this order."
        : `${formatUsd(purchase.totalCents)} is over ${formatUsd(policy.approvalThresholdCents)}, so it needs your OK.`,
    );
  } else if (policy.approvalThresholdCents !== null) {
    add("approval_threshold", "Approval threshold", "pass", `At or under ${formatUsd(policy.approvalThresholdCents)}.`);
  }

  // 8. New merchant (hold)
  const isNew = !policy.trustedMerchants.includes(purchase.merchantId) && !context.hasPurchasedFromMerchant;
  if (policy.requireApprovalForNewMerchants && isNew) {
    add(
      "new_merchant",
      "New merchant",
      context.humanApproved ? "pass" : "hold",
      context.humanApproved
        ? `You approved buying from ${purchase.merchantName}.`
        : `You haven't bought from ${purchase.merchantName} before.`,
    );
  } else if (policy.requireApprovalForNewMerchants) {
    add("new_merchant", "New merchant", "pass", `${purchase.merchantName} is a known merchant.`);
  }

  // 9. Pace (hold): many purchases in a short window is what a hijacked or looping agent looks like.
  if (policy.velocity) {
    const { maxPurchases, windowMinutes } = policy.velocity;
    const recent = context.recentPurchaseCount ?? 0;
    const window = windowMinutes === 60 ? "hour" : `${windowMinutes} minutes`;
    if (recent >= maxPurchases) {
      add(
        "velocity",
        "Pace",
        context.humanApproved ? "pass" : "hold",
        context.humanApproved
          ? "You approved going over your pace limit."
          : `Your agents already made ${recent} purchase${recent === 1 ? "" : "s"} in the last ${window} (your limit is ${maxPurchases} before you're asked).`,
      );
    } else {
      add("velocity", "Pace", "pass", `${recent} of ${maxPurchases} purchases in the last ${window}.`);
    }
  }

  // 10. Duplicate (hold): the same product bought recently.
  if (policy.duplicateWindowDays !== null) {
    const now = context.now ?? new Date();
    const dupes = purchase.items.filter((i) => context.lastBoughtAt?.[i.productId]);
    if (dupes.length > 0) {
      const first = dupes[0];
      add(
        "duplicate",
        "Repeat purchase",
        context.humanApproved ? "pass" : "hold",
        context.humanApproved
          ? "You approved buying this again."
          : `You bought ${first.name} ${ago(context.lastBoughtAt![first.productId], now)}.${dupes.length > 1 ? ` (and ${dupes.length - 1} more item${dupes.length > 2 ? "s" : ""} in this order)` : ""}`,
      );
    } else {
      add("duplicate", "Repeat purchase", "pass", `Nothing here was bought in the last ${policy.duplicateWindowDays} days.`);
    }
  }

  const blocks = checks.filter((c) => c.status === "block");
  const holds = checks.filter((c) => c.status === "hold");
  const outcome: Outcome = blocks.length > 0 ? "blocked" : holds.length > 0 ? "pending_approval" : "approved";
  const reasons = (blocks.length > 0 ? blocks : holds).map((c) => c.detail);
  return { outcome, checks, reasons };
}

/** "12 minutes ago", "3 hours ago", "2 days ago". */
export function ago(then: Date, now: Date) {
  const mins = Math.max(0, Math.round((now.getTime() - then.getTime()) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function list(xs: string[]) {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}
