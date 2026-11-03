import { describe, expect, it } from "vitest";
import { diffRules, ruleCards } from "./describe";
import { DEFAULT_POLICY } from "./schema";

describe("rule cards", () => {
  it("describes the default policy in plain English", () => {
    const v = ruleCards(DEFAULT_POLICY).map((c) => c.value);
    expect(v).toContain("$150.00 per month");
    expect(v).toContain("Max $40.00 per order");
    expect(v).toContain("Ask before anything over $25.00");
    expect(v).toContain("Only coffee and books");
  });
  it("marks only changed cards", () => {
    const d = diffRules(DEFAULT_POLICY, { ...DEFAULT_POLICY, monthlyLimitCents: 20_000 });
    expect(d.filter((c) => c.changed).map((c) => c.id)).toEqual(["monthlyLimitCents"]);
    expect(d.find((c) => c.id === "monthlyLimitCents")?.before).toBe("$150.00 per month");
  });
  it("everything is new when there are no current rules", () => {
    expect(diffRules(null, DEFAULT_POLICY).every((c) => c.changed)).toBe(true);
  });
});
