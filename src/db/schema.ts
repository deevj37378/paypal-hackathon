import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const vaultStatus = pgEnum("vault_status", ["active", "revoked"]);

export const purchaseStatus = pgEnum("purchase_status", [
  "requested",
  "blocked",
  "pending_approval",
  "approved",
  "declined",
  "captured",
  "paid_out",
  "refunded",
  "failed",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email"),
  name: text("name"),
  isDemo: integer("is_demo").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A buyer's saved PayPal wallet (PayPal Vault v3 payment token). */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("paypal_vaults_token_idx").on(t.paymentTokenId)],
);

/** Skeleton — fleshed out in M2 (agent, policy decision, approval, payout links). */
export const purchases = pgTable("purchases", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  merchantId: text("merchant_id").notNull(),
  items: jsonb("items").notNull(),
  totalCents: integer("total_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  status: purchaseStatus("status").notNull().default("requested"),
  paypalOrderId: text("paypal_order_id"),
  paypalCaptureId: text("paypal_capture_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
