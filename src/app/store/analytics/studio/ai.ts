import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgStudioApi } from "ag-studio";
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

const INSTRUCTIONS = () => `You are the Allowance analyst inside an AG Studio dashboard about purchases that AI agents asked to make.
Data: table "purchases" (one row per agent request; money in USD): date (Request Date), agentType (Agent), outcome, ruleDecision, blockReason, holdReason, category, total, charged, refunded, paidOut, payoutStatus, isRefunded. Table "items" has line items.
How to work:
- Questions about the dashboard: read it with view_page and reply briefly in plain English.
- Chart requests, in exactly this order, one call each:
  1. add_widget: type "bar-chart-grouped", a short kebab-case widgetId, xTrack 0, yTrack 0, xSpan 12, ySpan 16 (Studio moves it to free space).
  2. configure_bar_chart on that widget: category = the dimension (e.g. purchases.agentType or purchases.blockReason), value = the measure (e.g. sum of purchases.refunded, or distinct count of purchases.id), and a clear title.
  3. Only if a time period was asked for, add_widget_filter on purchases.date with a simple AND of greaterThanOrEqual and lessThanOrEqual date strings. For "why are purchases blocked", add_widget_filter on purchases.ruleDecision equals "Blocked by rules" instead.
  Then stop and say in one sentence what you added.
- Today is ${thisWeek().to}. "This week" means purchases.date from ${thisWeek().from} to ${thisWeek().to} (UTC).
- Use sums for money fields and a distinct count of purchases.id for counts.
- You can only read data and change this dashboard. You cannot buy, approve or refund anything; say so if asked.`;

/**
 * Widget types the analyst can configure. Each configure tool carries that widget type's full
 * options schema (~30 KB), so the list is kept short, and each gets a unique name (Studio would
 * otherwise advertise several tools all called "configure_widget", which LLM APIs reject).
 */
const CONFIGURABLE: [type: string, toolName: string][] = [["bar-chart-grouped", "configure_bar_chart"]];

export function buildAi(): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: "/api/studio-ai", model: "allowance-ai" });
  // 3.1's setup callback types `api` as the core API; at runtime it is the full AgStudioApi.
  return ({ api }) =>
    createAiHarness(api as unknown as AgStudioApi, ({ tools }) => ({
      agents: [
        directLlmRunner({
          id: "analyst",
          name: "Allowance analyst",
          adapter,
          maxTurns: 16,
          instructions: INSTRUCTIONS,
          tools: () => {
            const s = tools.studio;
            return [
              s.viewReport(),
              s.viewSchema(),
              s.viewPage(),
              s.addWidget(),
              s.removeWidget(),
              s.addWidgetFilter(),
              s.removeWidgetFilter(),
              ...CONFIGURABLE.map(([widgetType, name]) => s.configureWidget({ widgetType }, { name })),
            ];
          },
        }),
      ],
      primary: "analyst",
      promptStarters: PROMPT_STARTERS,
    }));
}
