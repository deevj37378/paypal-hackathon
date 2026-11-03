import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { CheckItem, CheckResult } from "@/lib/policy/check";
import type { PolicyRules } from "@/lib/policy/schema";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const vaultStatus = pgEnum("vault_status", ["active", "revoked"]);
export const policyStatus = pgEnum("policy_status", ["draft", "active", "archived"]);
export const agentStatus = pgEnum("agent_status", ["active", "revoked"]);

/** Purchase lifecycle. "captured" = buyer charged; payout to the merchant is tracked separately. */
export const purchaseStatus = pgEnum("purchase_status", [
  "blocked",
  "pending_approval",
  "declined",
  "expired",
  "processing",
  "captured",
  "failed",
  "refunded",
]);

/** Merchant payout lifecycle, held for a settlement window so refunds can cancel it. */
export const payoutStatus = pgEnum("payout_status", [
  "none",
  "scheduled",
  "processing",
  "sent",
  "paid",
  "cancelled",
  "failed",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name"),
  isDemo: integer("is_demo").notNull().default(0),
  createdAt: createdAt(),
});

/** A buyer's saved PayPal wallet (PayPal Vault v3 payment token). Never sent to the browser. */
export const paypalVaults = pgTable(
  "paypal_vaults",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    paymentTokenId: text("payment_token_id").notNull(),
    paypalCustomerId: text("paypal_customer_id"),
    payerEmail: text("payer_email"),
    status: vaultStatus("status").notNull().default("active"),
    raw: jsonb("raw"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("paypal_vaults_token_idx").on(t.paymentTokenId), index("paypal_vaults_user_idx").on(t.userId)],
);

export const policies = pgTable(
  "policies",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rules: jsonb("rules").$type<PolicyRules>().notNull(),
    /** The plain-English text the rules were compiled from (M5). */
    sourceText: text("source_text"),
    status: policyStatus("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [index("policies_user_idx").on(t.userId, t.status)],
);

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** sha256 of the API key; the key itself is shown once and never stored. */
    keyHash: text("key_hash").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    /** Last 4 characters of the key, so the owner can tell keys apart after the one-time reveal. */
    keyLast4: text("key_last4"),
    status: agentStatus("status").notNull().default("active"),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agents_key_hash_idx").on(t.keyHash), index("agents_user_idx").on(t.userId)],
);

export const merchants = pgTable("merchants", {
  id: text("id").primaryKey(), // slug, e.g. "demo-store"
  name: text("name").notNull(),
  payoutEmail: text("payout_email").notNull(),
  /** Refunded after the merchant was already paid: recovered from the next payouts. */
  clawbackCents: integer("clawback_cents").notNull().default(0),
  createdAt: createdAt(),
});

export const products = pgTable(
  "products",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull().references(() => merchants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    priceCents: integer("price_cents").notNull(),
    /** PayPal Catalog product id (synced in M6). */
    paypalProductId: text("paypal_product_id"),
    createdAt: createdAt(),
  },
  (t) => [index("products_merchant_idx").on(t.merchantId)],
);

export const purchases = pgTable(
  "purchases",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    merchantId: text("merchant_id").notNull().references(() => merchants.id),
    items: jsonb("items").$type<CheckItem[]>().notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    /** Why the agent says it's buying this. */
    reason: text("reason"),
    status: purchaseStatus("status").notNull(),
    decision: jsonb("decision").$type<CheckResult>().notNull(),
    policyId: text("policy_id").references(() => policies.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key"),
    approvalExpiresAt: ts("approval_expires_at"),
    decidedAt: ts("decided_at"),
    decidedVia: text("decided_via"),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    paypalRefundId: text("paypal_refund_id"),
    failureReason: text("failure_reason"),
    payoutStatus: payoutStatus("payout_status").notNull().default("none"),
    payoutDueAt: ts("payout_due_at"),
    payoutCents: integer("payout_cents"),
    payoutBatchId: text("payout_batch_id"),
    capturedAt: ts("captured_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("purchases_user_idx").on(t.userId, t.createdAt),
    index("purchases_payout_due_idx").on(t.payoutStatus, t.payoutDueAt),
    uniqueIndex("purchases_agent_idem_idx")
      .on(t.agentId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

/** Append-only timeline for the purchase detail page. */
export const purchaseEvents = pgTable(
  "purchase_events",
  {
    id: text("id").primaryKey(),
    purchaseId: text("purchase_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("purchase_events_purchase_idx").on(t.purchaseId, t.createdAt)],
);

/** Fixed-window counters for free, DB-backed rate limiting (agents, AI endpoints, demo creation). */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
