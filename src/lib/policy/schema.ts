import { z } from "zod";

/**
 * The strict, machine-checkable spending policy.
 * In M5 Gemini compiles plain-English rules into this shape; it is always validated here
 * and confirmed by the human before it becomes active. The checker only ever reads this.
 */
const cents = z.number().int().nonnegative().max(10_000_000); // ≤ $100k
const slug = z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9][a-z0-9-]*$/);

export const PolicyRules = z
  .object({
    version: z.literal(1),
    currency: z.literal("USD"),
    /** Total that may be charged per calendar month (UTC). */
    monthlyLimitCents: cents.min(1),
    /** Hard cap for a single order. null = no per-order cap (monthly limit still applies). */
    perOrderLimitCents: cents.min(1).nullable(),
    /** Orders strictly above this need a human approval. null = never ask on amount. */
    approvalThresholdCents: cents.nullable(),
    /** Every item's category must be in this list. Empty list = any category. */
    allowedCategories: z.array(slug).max(50),
    /** Items in these categories are always blocked. */
    blockedCategories: z.array(slug).max(50),
    /** Merchants that are never allowed. */
    blockedMerchants: z.array(slug).max(100),
    /** Merchants the user already trusts (never treated as "new"). */
    trustedMerchants: z.array(slug).max(100),
    /** Ask before buying from a merchant that isn't trusted and hasn't been bought from before. */
    requireApprovalForNewMerchants: z.boolean(),
    /**
     * Pace limit: hold when the agents already made this many purchases in the window (a hijacked
     * agent tends to spend fast). null = off. Defaults apply to rules saved before this existed.
     */
    velocity: z
      .object({ maxPurchases: z.number().int().min(1).max(100), windowMinutes: z.number().int().min(1).max(1440) })
      .strict()
      .nullable()
      .default({ maxPurchases: 3, windowMinutes: 10 }),
    /** Hold a product already bought within this many days (duplicate orders). null = off. */
    duplicateWindowDays: z.number().int().min(1).max(90).nullable().default(7),
  })
  .strict();

export type PolicyRules = z.infer<typeof PolicyRules>;

/** The demo story: "$150/month, only coffee and books, max $40 per order, ask me over $25,
 *  never buy from new merchants without asking." */
export const DEFAULT_POLICY: PolicyRules = {
  version: 1,
  currency: "USD",
  monthlyLimitCents: 15_000,
  perOrderLimitCents: 4_000,
  approvalThresholdCents: 2_500,
  allowedCategories: ["coffee", "books"],
  blockedCategories: [],
  blockedMerchants: [],
  trustedMerchants: ["demo-store"],
  requireApprovalForNewMerchants: true,
  velocity: { maxPurchases: 3, windowMinutes: 10 },
  duplicateWindowDays: 7,
};
