import { describe, expect, it } from "vitest";
import type { AnalyticsData, PurchaseRow } from "@/lib/analytics/data";
import { buildCatalog, checkFilterArgs, checkWidget, emptyNewWidgets, resolveValue, withResultCheck } from "./guard";

const row = (o: Partial<PurchaseRow>): PurchaseRow => ({
  id: Math.random().toString(36), date: "2026-11-03", day: "Nov 3", createdAt: "2026-11-03T10:00:00Z", merchant: "Bean & Page",
  agentType: "Claude (MCP)", outcome: "Charged", ruleDecision: "Approved by rules", blockReason: "Not blocked", holdReason: "Not held",
  category: "coffee", itemCount: 1, total: 18, charged: 18, isCharged: true, isRefunded: false, refunded: 0, payoutStatus: "Paid out",
  isPaidOut: true, paidOut: 18, isDemo: false, ...o,
});
const rows = [
  row({}),
  row({ ruleDecision: "Blocked by rules", outcome: "Blocked by rules", blockReason: "Category not allowed", charged: 0, category: "kitchen" }),
  row({ ruleDecision: "Blocked by rules", outcome: "Blocked by rules", blockReason: "Over per-order limit", charged: 0, date: "2026-11-05" }),
  row({ outcome: "Charged, then refunded", isRefunded: true, refunded: 18, date: "2026-11-04" }),
];
const data: AnalyticsData = { purchases: rows, items: [], merchants: [], asOf: "2026-11-06T00:00:00Z" };
const catalog = buildCatalog(data);
const apiWith = (widgets: Record<string, unknown>, widgetFilters: Record<string, unknown[]> = {}) =>
  ({ getState: () => ({ selectedPageId: "p", pages: [{ id: "p", widgets, filter: { widget: widgetFilters } }] }) }) as never;

describe("analytics assistant guard", () => {
  it("lists exact stored values", () => {
    expect(catalog["purchases.ruleDecision"]).toEqual(["Approved by rules", "Blocked by rules"]);
  });
  it("maps obvious labels onto stored values", () => {
    expect(resolveValue("blocked", catalog["purchases.ruleDecision"])).toBe("Blocked by rules");
    expect(resolveValue("claude (mcp)", catalog["purchases.agentType"])).toBe("Claude (MCP)");
    expect(resolveValue("rules", catalog["purchases.ruleDecision"])).toBeNull(); // ambiguous
  });
  it("fixes or rejects filter values", () => {
    const ok = checkFilterArgs({ widgetId: "w", value: { field: { id: "purchases.ruleDecision" }, model: { operator: "equals", value: "Blocked" } } }, catalog);
    expect("args" in ok && ok.args.value.model.value).toBe("Blocked by rules");
    const bad = checkFilterArgs({ widgetId: "w", value: { field: { id: "purchases.blockReason" }, model: { operator: "isIn", value: ["Spending too high"] } } }, catalog);
    expect("error" in bad && bad.error).toMatch(/Use one of exactly: .*"Category not allowed"/);
  });
  it("counts a widget's rows through its filters", () => {
    const w = { type: "bar-chart-grouped", dataMapping: { valueKey: [{ id: "purchases.refunded", aggregation: "sum" }] }, format: { title: { text: "Refunds" } } };
    const thisWeek = { field: { id: "purchases.date" }, model: { operator: "AND", conditions: [{ operator: "greaterThanOrEqual", value: "2026-11-02" }, { operator: "lessThanOrEqual", value: "2026-11-06" }] } };
    expect(checkWidget(apiWith({ w }, { w: [thisWeek] }), rows, "w")).toMatchObject({ rows: 4, measureTotal: 18 });
    const blockedOnly = { field: { id: "purchases.ruleDecision" }, model: { operator: "equals", value: "Blocked by rules" } };
    // Blocked purchases have no refunds: rows exist but the value is all zero → counts as empty.
    expect(emptyNewWidgets(apiWith({ w }, { w: [blockedOnly] }), rows).map((c) => c.id)).toEqual(["w"]);
  });
  it("holds back a 'done' answer once when a new widget is empty", async () => {
    const calls: unknown[] = [];
    const turn = (text: string) => ({
      stream: (async function* () { yield { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: text }; })(),
      complete: Promise.resolve({ id: "r", output: [{ kind: "output", type: "message", role: "assistant", content: [{ type: "text", text }] }] } as never),
    });
    let n = 0;
    const inner = { executeTurn: (req: { input: unknown[] }) => (calls.push(req.input), turn(n++ === 0 ? "Done!" : "Fixed the filter.")) };
    const wrapped = withResultCheck(inner as never, () => "The widget shows no data; fix or remove the filter.");
    const h = wrapped.executeTurn({ input: [] } as never);
    const evs: string[] = [];
    for await (const e of h.stream as AsyncIterable<{ delta: string }>) evs.push(e.delta);
    expect(evs).toEqual(["Fixed the filter."]);
    expect(calls).toHaveLength(2);
  });
});
