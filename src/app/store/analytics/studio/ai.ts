import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgStudioApi } from "ag-studio";
import type { AnalyticsData } from "@/lib/analytics/data";
import { buildCatalog, describeCatalog, emptyNewWidgets, guardConfigureTool, guardFilterTool, renderedEmptyNewWidgets, withResultCheck } from "./guard";
import { openaiAdapter } from "./openai-adapter";

/**
 * AG Studio's Agent Framework on Allowance's free AI setup.
 *
 * The adapter (AG Studio's own OpenAI example, unchanged) speaks the OpenAI Responses protocol to
 * /api/studio-ai/responses, which runs each turn on Allowance's free Gemini → Groq model chain and
 * answers in the same protocol. No key ever reaches the browser.
 *
 * One focused agent instead of Studio's five-agent team: free fallback models handle a flat tool
 * list far more reliably than nested delegation. Read-only by construction: it only gets Studio's
 * dashboard tools and has no way to call Allowance's purchase, approval or refund APIs.
 */
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Refunds by agent this week", prompt: "Show refunds by agent this week as a new widget." },
  { label: "Why are purchases blocked?", prompt: "Which rule blocks the most agent purchases? Add a chart for it." },
  { label: "Summarise this page", prompt: "Summarise what this dashboard shows and what stands out." },
];

/** "This week" as concrete dates (UTC, Monday start), re-computed on every run. */
function thisWeek() {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  return { from: monday.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

const instructionsFor = (valueList: string) => () => `You are the Allowance analyst inside an AG Studio dashboard about purchases that AI agents asked to make.
Data: table "purchases" (one row per agent request; money in USD): date (Request Date), agentType (Agent), outcome, ruleDecision, blockReason, holdReason, category, total, charged, refunded, paidOut, payoutStatus, isRefunded. Table "items" has line items.
How to work:
- Questions about the dashboard: read it with view_page and reply briefly in plain English.
- Chart requests, in exactly this order, one call each:
  1. add_widget: type "bar-chart-grouped", a short kebab-case widgetId, xTrack 0, yTrack 0, xSpan 12, ySpan 16 (Studio moves it to free space).
  2. configure_bar_chart on that widget: set ONLY categoryKey (the dimension, e.g. purchases.agentType or purchases.blockReason, no aggregation) and valueKey (the measure, e.g. sum of purchases.refunded, or distinct count of purchases.id), plus a clear title. Leave legendKey and tooltipKey empty.
  3. Only if a time period was asked for, add_widget_filter on purchases.date with a simple AND of greaterThanOrEqual and lessThanOrEqual date strings. For "why are purchases blocked", add_widget_filter on purchases.ruleDecision equals "Blocked by rules" instead.
  Then stop and say in one sentence what you added.
- Today is ${thisWeek().to}. "This week" means purchases.date from ${thisWeek().from} to ${thisWeek().to} (UTC).
- Use sums for money fields and a distinct count of purchases.id for counts.
- Filter values must be EXACTLY one of these stored values (copy them as written; labels you see on screen may differ):
${valueList}
- If a tool result says a widget shows NO DATA, fix its filter with exact stored values or remove the filter before you finish.
- You can only read data and change this dashboard. You cannot buy, approve or refund anything; say so if asked.`;

/**
 * Widget types the analyst can configure. Each configure tool carries that widget type's full
 * options schema (~30 KB), so the list is kept short, and each gets a unique name (Studio would
 * otherwise advertise several tools all called "configure_widget", which LLM APIs reject).
 */
const CONFIGURABLE: [type: string, toolName: string][] = [["bar-chart-grouped", "configure_bar_chart"]];

export function buildAi(data: AnalyticsData, getApi: () => AgStudioApi | null): AgAiHarnessSetup {
  const catalog = buildCatalog(data);
  const instructions = instructionsFor(describeCatalog(catalog));
  // Never end on an empty chart: if the model says it's done while a widget it added has no data,
  // hold that answer back and give it one turn to fix the widget.
  const adapter = withResultCheck(openaiAdapter({ endpoint: "/api/studio-ai", model: "allowance-ai" }), () => {
    const api = getApi();
    if (!api) return null;
    const empty = emptyNewWidgets(api, data.purchases);
    if (empty.length) {
      return `The widget "${empty[0].title}" (${empty[0].id}) shows no data: ${empty[0].rows === 0 ? "no rows match its filters" : "every matching row has 0 for its value"}. Fix its filter using the exact stored values, or remove the filter, so it shows data. Then confirm in one sentence.`;
    }
    const rendered = renderedEmptyNewWidgets(api);
    if (rendered.length) {
      return `The widget "${rendered[0].title}" (${rendered[0].id}) displays "No data to display". Reconfigure it with configure_bar_chart using only categoryKey (a plain field) and valueKey (a measure), and leave legendKey/tooltipKey empty, so it shows data. Then confirm in one sentence.`;
    }
    return null;
  });
  // 3.1's setup callback types `api` as the core API; at runtime it is the full AgStudioApi.
  return ({ api }) =>
    createAiHarness(api as unknown as AgStudioApi, ({ tools }) => ({
      agents: [
        directLlmRunner({
          id: "analyst",
          name: "Allowance analyst",
          adapter,
          maxTurns: 16,
          instructions,
          tools: () => {
            const s = tools.studio;
            return [
              s.viewReport(),
              s.viewSchema(),
              s.viewPage(),
              s.addWidget(),
              s.removeWidget(),
              guardFilterTool(s.addWidgetFilter(), catalog, getApi, data.purchases),
              s.removeWidgetFilter(),
              ...CONFIGURABLE.map(([widgetType, name]) => guardConfigureTool(s.configureWidget({ widgetType }, { name }), getApi, data.purchases)),
            ];
          },
        }),
      ],
      primary: "analyst",
      promptStarters: PROMPT_STARTERS,
    }));
}
