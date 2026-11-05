import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat } from "ag-studio";
import type { AnalyticsData } from "@/lib/analytics/data";
import type { AllowanceRegistry } from "./registry";

/** AG Studio data sources: purchases (one row per agent purchase request), their line items, and merchants. */

type FieldSpec = [id: string, name: string, format: AgFormat<AllowanceRegistry>, hide?: boolean];
const USD = { format: "$#,##0.00" };
const fields = (specs: FieldSpec[]): AgFieldDefinition<AllowanceRegistry>[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(format === "currencyFormat" && { formatOptions: USD }), ...(hide && { hide }) }));
const sumOf = (id: string) => ({ id, aggregation: "sum" as const });
const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition<AllowanceRegistry> => ({
  id,
  name,
  description,
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [sumOf(numerator), sumOf(denominator)] },
});

export const CALENDAR_ID = "calendar";

export function buildStudioData(data: AnalyticsData): AgDataSourcesDefinition<AllowanceRegistry> {
  const dates = data.purchases.map((p) => p.date).sort();
  const today = data.asOf.slice(0, 10);
  return {
    description:
      "Purchases that AI agents asked to make at the Allowance demo store (Bean & Page, plus Gadget Hub), in USD. " +
      "Every request was checked by a deterministic rule checker: approved and charged to the owner's PayPal, held for the owner's approval, or blocked with a reason. " +
      "Charged orders are paid out to the merchant with PayPal Payouts after a refund window. Buyers are anonymous; agents are grouped by type.",
    sources: [
      {
        id: "purchases",
        description:
          "One row per purchase request from an agent. Outcome combines the rule decision and the owner's choice. Charged/refunded/paid out are USD amounts (0 when not applicable).",
        data: data.purchases,
        fields: fields([
          ["id", "Purchase ID", "textFormat", true],
          ["date", "Request Date", "dateFormat"],
          ["createdAt", "Requested At", "dateTimeFormat", true],
          ["merchant", "Merchant", "textFormat"],
          ["agentType", "Agent", "textFormat"],
          ["outcome", "Outcome", "textFormat"],
          ["ruleDecision", "Rule Decision", "textFormat"],
          ["blockReason", "Block Reason", "textFormat"],
          ["holdReason", "Hold Reason", "textFormat"],
          ["category", "Category", "textFormat"],
          ["itemCount", "Items", "integerFormat"],
          ["total", "Requested Amount", "currencyFormat"],
          ["charged", "Charged", "currencyFormat"],
          ["isCharged", "Was Charged", "booleanFormat"],
          ["isRefunded", "Was Refunded", "booleanFormat"],
          ["refunded", "Refunded", "currencyFormat"],
          ["payoutStatus", "Payout Status", "textFormat"],
          ["isPaidOut", "Paid Out", "booleanFormat"],
          ["paidOut", "Paid Out Amount", "currencyFormat"],
          ["isDemo", "Demo Account", "booleanFormat", true],
        ]),
      },
      {
        id: "items",
        name: "Line Items",
        description: "Products in each purchase request, with the store's price (never the agent's).",
        data: data.items,
        fields: fields([
          ["id", "Line ID", "textFormat", true],
          ["purchaseId", "Purchase ID", "textFormat", true],
          ["product", "Product", "textFormat"],
          ["category", "Product Category", "textFormat"],
          ["quantity", "Quantity", "integerFormat"],
          ["amount", "Line Amount", "currencyFormat"],
        ]),
      },
      {
        id: "merchants",
        description: "Merchants and refunds still owed back after a payout (clawback netted from future payouts).",
        data: data.merchants,
        fields: fields([
          ["id", "Merchant ID", "textFormat", true],
          ["name", "Merchant Name", "textFormat"],
          ["clawbackOutstanding", "Clawback Outstanding", "currencyFormat"],
        ]),
      },
    ],
    relationships: [
      {
        id: "item-purchase",
        source: { tableId: "items", fieldId: "purchaseId" },
        target: { tableId: "purchases", fieldId: "id" },
        type: "many-to-one",
      },
      { id: "purchases-calendar", source: { tableId: "purchases", fieldId: "date" }, target: { calendarId: CALENDAR_ID } },
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: { from: { type: "date", value: dates[0] ?? today }, to: { type: "date", value: today } },
        fragments: ["year", "month", "week", "day", "dayOfWeek"],
      },
    ],
    expressions: [
      ratio("refundRate", "Refund Rate", "Refunded / charged.", "purchases.refunded", "purchases.charged"),
      ratio("payoutRate", "Payout Rate", "Paid out / charged.", "purchases.paidOut", "purchases.charged"),
    ],
  };
}
