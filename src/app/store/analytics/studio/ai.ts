import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter, type AgStudioApi } from "ag-studio";
import { openaiAdapter } from "./openai-adapter";

/**
 * AG Studio's built-in agents (Studio Agent Framework) on Allowance's free AI setup.
 * The adapter (AG Studio's own OpenAI example, unchanged) speaks the OpenAI Responses protocol to
 * /api/studio-ai/responses, which runs each turn on Allowance's free Gemini → Groq model chain and
 * answers in the same protocol. No key ever reaches the browser.
 *
 * Read-only by construction: Studio's agents only get Studio's tools (read the schema, query the
 * in-browser data, add or edit widgets). They have no way to call Allowance's purchase, approval
 * or refund APIs.
 */
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: "Refunds by agent this week", prompt: "Show refunds by agent this week as a new widget." },
  { label: "Why are purchases blocked?", prompt: "Which rule blocks the most agent purchases? Add a chart for it." },
  { label: "Summarise this page", prompt: "Summarise what this dashboard shows and what stands out." },
];

export function buildAi(): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: "/api/studio-ai", model: "allowance-ai" });
  // 3.1's setup callback types `api` as the core API; at runtime it is the full AgStudioApi.
  return ({ api }) => createAiHarness(api as unknown as AgStudioApi, { adapter, promptStarters: PROMPT_STARTERS });
}
