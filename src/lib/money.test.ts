import { describe, expect, it } from "vitest";
import { centsToValue, toCents } from "./money";

describe("money", () => {
  it("round-trips", () => {
    for (const v of ["0.01", "18.00", "32.5", "150"]) expect(centsToValue(toCents(v))).toBe(Number(v).toFixed(2));
  });
  it("rejects bad input", () => {
    expect(() => toCents("1.234")).toThrow();
    expect(() => toCents("-1")).toThrow();
    expect(() => centsToValue(1.5)).toThrow();
  });
});
