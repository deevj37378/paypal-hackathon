import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { AllowanceRegistry } from "./registry";
import { FONT } from "./theme";

/** The default "Agent commerce" report. Field ids ('purchases.charged') refer to ./data.ts. */

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });
const typo = (fontSize: number, fontWeight: "normal" | "bold" = "normal") => ({ fontFamily: FONT, fontSize, fontWeight, fontStyle: "normal" as const });

const kpi = (text: string, value: { id: string; aggregation?: "sum" | "countd" }, sparklineX?: string) => ({
  type: "value" as const,
  dataMapping: { value: [value], ...(sparklineX && { sparklineX: [{ id: sparklineX }] }) },
  format: {
    title: { enabled: true, text, typography: typo(13, "bold") },
    caption: { enabled: true, text: "", typography: typo(0) },
    style: { typography: typo(24, "bold") },
  },
});

const overview: AgPageState<AllowanceRegistry> = {
  id: "overview",
  widgets: {
    "kpi-requests": kpi("Agent requests", countd("purchases.id"), "calendar::day"),
    "kpi-charged": kpi("Charged to PayPal", sum("purchases.charged"), "calendar::day"),
    "kpi-paid-out": kpi("Paid out to merchants", sum("purchases.paidOut"), "calendar::day"),
    "kpi-refunded": kpi("Refunded", sum("purchases.refunded")),
    agent: {
      type: "button-filter",
      dataMapping: { value: [{ id: "purchases.agentType" }] },
      format: { ...title("Agent"), style: { selection: { type: "multiple" }, dimensions: { height: 28, minWidth: 64 } } },
    },
    flow: {
      type: "decision-flow",
      dataMapping: {
        decision: [{ id: "purchases.ruleDecision" }],
        outcome: [{ id: "purchases.outcome" }],
        payout: [{ id: "purchases.payoutStatus" }],
        count: [countd("purchases.id")],
      },
      format: title("What the rule checker decided"),
    },
    "outcome-by-agent": {
      type: "bar-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "purchases.agentType" }],
        valueKey: [countd("purchases.id")],
        legendKey: [{ id: "purchases.outcome" }],
      },
      format: { ...title("Outcomes by agent"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    "block-reasons": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "purchases.blockReason" }], valueKey: [countd("purchases.id")] },
      format: { ...title("Top block reasons"), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    "spend-by-category": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "calendar::day" }],
        valueKey: [sum("purchases.charged")],
        legendKey: [{ id: "purchases.category" }],
      },
      format: { ...title("Charged by category over time"), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    payouts: {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "purchases.payoutStatus" }], valueKey: [sum("purchases.charged")] },
      format: { ...title("Where charged money went"), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    "recent": {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "purchases.createdAt" },
          { id: "purchases.agentType" },
          { id: "purchases.outcome" },
          { id: "purchases.blockReason" },
          { id: "purchases.category" },
          sum("purchases.total"),
          sum("purchases.charged"),
          { id: "purchases.payoutStatus" },
        ],
      },
      sort: [{ field: { id: "purchases.createdAt" }, direction: "desc" }],
      format: title("Every agent request"),
    },
  },
  widgetLayout: {
    "kpi-requests": at(0, 0, 4, 7),
    "kpi-charged": at(4, 0, 4, 7),
    "kpi-paid-out": at(8, 0, 4, 7),
    "kpi-refunded": at(12, 0, 4, 7),
    agent: at(16, 0, 8, 7),
    flow: at(0, 7, 24, 14),
    "outcome-by-agent": at(0, 21, 14, 17),
    "block-reasons": at(14, 21, 10, 17),
    "spend-by-category": at(0, 38, 14, 17),
    payouts: at(14, 38, 10, 17),
    recent: at(0, 55, 24, 20),
  },
  filter: {
    // Only blocked purchases have a block reason; hide the blank slice.
    widget: { "block-reasons": [{ field: { id: "purchases.blockReason" }, model: { operator: "isNotBlank" } }] },
  },
};

export const defaultReport: AgReportState<AllowanceRegistry> = {
  selectedPageId: overview.id,
  pages: [overview],
  panels: { filters: { collapsed: true } },
};
