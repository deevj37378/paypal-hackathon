import { describe, expect, it } from "vitest";
import { checkPurchase, type CheckInput, type CheckItem } from "./check";
import { DEFAULT_POLICY, PolicyRules } from "./schema";

const coffee: CheckItem = { productId: "p1", name: "House coffee beans", category: "coffee", quantity: 1, unitPriceCents: 1800 };
const book: CheckItem = { productId: "p2", name: "The Pragmatic Programmer", category: "books", quantity: 1, unitPriceCents: 3200 };
const headphones: CheckItem = { productId: "p3", name: "Headphones", category: "electronics", quantity: 1, unitPriceCents: 2000 };

function input(items: CheckItem[], over: Partial<CheckInput["purchase"]> = {}, ctx: Partial<CheckInput["context"]> = {}, policy = DEFAULT_POLICY): CheckInput {
  const total = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  return {
    policy,
    purchase: { merchantId: "demo-store", merchantName: "Demo Store", currency: "USD", items, totalCents: total, claimedTotalCents: total, ...over },
    context: { spentThisMonthCents: 0, hasPurchasedFromMerchant: false, ...ctx },
  };
}

describe("checkPurchase: the demo story", () => {
  it("auto-approves $18 coffee from a trusted merchant", () => {
    const r = checkPurchase(input([coffee]));
    expect(r.outcome).toBe("approved");
    expect(r.checks.every((c) => c.status === "pass")).toBe(true);
  });

  it("holds a $32 book for approval (over $25 threshold)", () => {
    const r = checkPurchase(input([book]));
    expect(r.outcome).toBe("pending_approval");
    expect(r.checks.find((c) => c.id === "approval_threshold")?.status).toBe("hold");
    expect(r.reasons[0]).toMatch(/needs your OK/);
  });

  it("approves the held book once a human approved it", () => {
    expect(checkPurchase(input([book], {}, { humanApproved: true })).outcome).toBe("approved");
  });

  it("blocks a category that isn't allowed", () => {
    const r = checkPurchase(input([headphones]));
    expect(r.outcome).toBe("blocked");
    expect(r.reasons[0]).toMatch(/Electronics isn't in your allowed categories/);
  });

  it("blocks a mixed cart if any item is outside allowed categories", () => {
    expect(checkPurchase(input([coffee, { ...headphones, unitPriceCents: 500 }])).outcome).toBe("blocked");
  });
});

describe("checkPurchase: limits", () => {
  it("blocks over the per-order cap even if a human approved", () => {
    const big = { ...book, unitPriceCents: 4500 };
    expect(checkPurchase(input([big], {}, { humanApproved: true })).outcome).toBe("blocked");
  });

  it("allows exactly the per-order cap (then holds for approval)", () => {
    expect(checkPurchase(input([{ ...book, unitPriceCents: 4000 }])).outcome).toBe("pending_approval");
  });

  it("blocks when the monthly limit would be exceeded", () => {
    const r = checkPurchase(input([coffee], {}, { spentThisMonthCents: 14_000 }));
    expect(r.outcome).toBe("blocked");
    expect(r.reasons[0]).toMatch(/Only \$10\.00 of your \$150\.00/);
  });

  it("allows spending exactly up to the monthly limit", () => {
    expect(checkPurchase(input([coffee], {}, { spentThisMonthCents: 13_200 })).outcome).toBe("approved");
  });

  it("monthly limit still applies after human approval", () => {
    expect(checkPurchase(input([book], {}, { spentThisMonthCents: 14_000, humanApproved: true })).outcome).toBe("blocked");
  });

  it("amount at the threshold is not held (strictly above only)", () => {
    expect(checkPurchase(input([{ ...coffee, unitPriceCents: 2500 }])).outcome).toBe("approved");
  });

  it("multiplies quantity into the total", () => {
    const r = checkPurchase(input([{ ...coffee, quantity: 2 }]));
    expect(r.outcome).toBe("pending_approval"); // $36 > $25
  });
});

describe("checkPurchase: merchants", () => {
  const unknown = { merchantId: "gadget-hub", merchantName: "Gadget Hub" };

  it("holds purchases from a new merchant", () => {
    const r = checkPurchase(input([coffee], unknown));
    expect(r.outcome).toBe("pending_approval");
    expect(r.reasons[0]).toMatch(/haven't bought from Gadget Hub/);
  });

  it("doesn't treat a merchant as new after a previous purchase", () => {
    expect(checkPurchase(input([coffee], unknown, { hasPurchasedFromMerchant: true })).outcome).toBe("approved");
  });

  it("blocks a blocked merchant", () => {
    const policy = { ...DEFAULT_POLICY, blockedMerchants: ["demo-store"] };
    expect(checkPurchase(input([coffee], {}, {}, policy)).outcome).toBe("blocked");
  });

  it("new-merchant rule can be turned off", () => {
    const policy = { ...DEFAULT_POLICY, requireApprovalForNewMerchants: false };
    expect(checkPurchase(input([coffee], unknown, {}, policy)).outcome).toBe("approved");
  });
});

describe("checkPurchase: integrity", () => {
  it("blocks when the agent's total doesn't match store prices", () => {
    const r = checkPurchase(input([coffee], { claimedTotalCents: 100 }));
    expect(r.outcome).toBe("blocked");
    expect(r.reasons[0]).toMatch(/doesn't match/);
  });

  it("blocks empty orders", () => {
    expect(checkPurchase(input([])).outcome).toBe("blocked");
  });

  it("blocks non-USD", () => {
    expect(checkPurchase(input([coffee], { currency: "EUR" })).outcome).toBe("blocked");
  });

  it("blocks take precedence over holds", () => {
    // new merchant (hold) + electronics (block)
    expect(checkPurchase(input([headphones], { merchantId: "x", merchantName: "X" })).outcome).toBe("blocked");
  });

  it("empty allowedCategories means any category", () => {
    const policy = { ...DEFAULT_POLICY, allowedCategories: [] };
    expect(checkPurchase(input([headphones], {}, {}, policy)).outcome).toBe("approved");
  });

  it("is deterministic", () => {
    const i = input([book]);
    expect(checkPurchase(i)).toEqual(checkPurchase(i));
  });
});

describe("PolicyRules schema", () => {
  it("accepts the default policy", () => {
    expect(PolicyRules.parse(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
  });
  it("rejects unknown keys and floats", () => {
    expect(() => PolicyRules.parse({ ...DEFAULT_POLICY, sneaky: true })).toThrow();
    expect(() => PolicyRules.parse({ ...DEFAULT_POLICY, monthlyLimitCents: 150.5 })).toThrow();
  });
});
