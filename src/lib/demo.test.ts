import { describe, expect, it } from "vitest";
import { demoKey, demoScenarioOf } from "./demo";

describe("guided-demo purchase tags", () => {
  it("round-trips the step through the idempotency key", () => {
    expect(demoScenarioOf(demoKey("coffee"))).toBe("coffee");
    expect(demoScenarioOf(demoKey("tricked"))).toBe("tricked");
    expect(demoKey("coffee").length).toBeLessThanOrEqual(100); // RequestPurchaseInput max
  });
  it("ignores chat / MCP keys and unknown steps", () => {
    expect(demoScenarioOf(crypto.randomUUID())).toBeNull();
    expect(demoScenarioOf("restock-coffee-1")).toBeNull();
    expect(demoScenarioOf("demo:nope:123")).toBeNull();
    expect(demoScenarioOf(null)).toBeNull();
  });
});
