import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, tool, type UIMessage } from "ai";
import { z } from "zod";
import { AgentAuthError, getBuiltinAgent, requireActiveAgent } from "@/lib/agents";
import {
  allowanceStatus,
  PurchaseStatusInput,
  purchaseStatus,
  RequestPurchaseInput,
  requestPurchaseTool,
  SearchStoreInput,
  searchStore,
  TOOL_DESCRIPTIONS,
} from "@/lib/agent/tools";
import { aiQuota } from "@/lib/ai/limits";
import { getModel } from "@/lib/ai/model";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { PurchaseInputError } from "@/lib/purchases/service";
import { RateLimitError } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/session";

export const maxDuration = 120; // multi-step tool use + free-tier fallbacks can be slow

const SYSTEM = `You are the owner's shopping assistant inside Allowance. You can spend the owner's money via PayPal, but only through the tools, and only within the owner's rules, which a deterministic checker enforces (you cannot override it).
How to work:
1. Call get_allowance_status first to learn the budget and rules.
2. Use search_store to find exact product_ids and prices. Never invent products or prices.
3. Call request_purchase once per merchant order, with the exact total and a short reason, and a fresh idempotency_key (any unique string).
4. Report each result plainly: "approved" = paid; "pending_approval" = the owner must approve (say so; you may check later with get_purchase_status); "blocked" = explain the reason, don't retry or work around it.
Keep replies short and friendly, in plain text (no markdown, no asterisks).
The person you are chatting with IS the owner: always say "you"/"your" (e.g. "it's waiting for your approval"), never "the owner". Never show purchase IDs (pur_…), product IDs or other internal identifiers; name things in plain words instead. The demo store sells coffee and books (and a few things the default rules block). Defaults so you never need to ask: "my coffee" / "restock my coffee" means 1 bag of House Blend Coffee Beans (12oz) (product_id coffee-house-blend). "The book I mentioned" without a title means The Pragmatic Programmer (book-pragmatic). Only ask a question if the request is truly ambiguous beyond these defaults.`;

const Body = z.object({ messages: z.array(z.any()).min(1).max(40) }).passthrough();

/** Run a shared tool as the built-in agent, re-checking the kill switch on every call. */
async function asAgent<T>(agentId: string, fn: (agent: Awaited<ReturnType<typeof requireActiveAgent>>) => Promise<{ summary: string; data: T }>) {
  try {
    const agent = await requireActiveAgent(agentId);
    const { summary, data } = await fn(agent);
    return { summary, data };
  } catch (e) {
    if (e instanceof AgentAuthError || e instanceof PurchaseInputError || e instanceof RateLimitError) return { error: e.message };
    if (e instanceof z.ZodError) return { error: `Invalid input: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
    console.error("[agent tool]", e);
    return { error: "Something went wrong on Allowance's side. Nothing was charged." };
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const raw = await req.text();
    if (raw.length > 200_000) return Response.json({ error: "invalid_request", message: "Conversation too long. Start a new chat." }, { status: 413 });
    const { messages } = Body.parse(JSON.parse(raw));
    const model = getModel("smart");
    if (!model) return Response.json({ error: "unavailable", message: "The built-in agent is offline (AI unavailable). Connect Claude via MCP instead." }, { status: 503 });

    const agent = await getBuiltinAgent(userId, { create: true });
    if (!agent || agent.status !== "active") {
      return Response.json({ error: "revoked", message: "You revoked the built-in assistant. Turn it back on from the Agents page." }, { status: 403 });
    }
    await aiQuota(`chat:${userId}`, 40);

    const result = streamText({
      model,
      maxRetries: 1,
      system: SYSTEM,
      messages: await convertToModelMessages((messages as UIMessage[]).slice(-16)),
      stopWhen: isStepCount(8),
      onError: ({ error }) => console.error("[agent chat] stream error:", (error as { statusCode?: number })?.statusCode ?? "", (error as Error)?.message?.slice(0, 300)),
      tools: {
        get_allowance_status: tool({
          description: TOOL_DESCRIPTIONS.get_allowance_status,
          inputSchema: z.object({}),
          execute: async () => asAgent(agent.id, (a) => allowanceStatus(a)),
        }),
        search_store: tool({
          description: TOOL_DESCRIPTIONS.search_store,
          inputSchema: SearchStoreInput,
          execute: async (input) => asAgent(agent.id, (a) => searchStore(a, input)),
        }),
        request_purchase: tool({
          description: TOOL_DESCRIPTIONS.request_purchase,
          inputSchema: RequestPurchaseInput,
          execute: async (input) => asAgent(agent.id, (a) => requestPurchaseTool(a, input)),
        }),
        get_purchase_status: tool({
          description: TOOL_DESCRIPTIONS.get_purchase_status,
          inputSchema: PurchaseStatusInput,
          execute: async (input) => asAgent(agent.id, (a) => purchaseStatus(a, input)),
        }),
      },
    });
    return createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) });
  } catch (e) {
    return errorResponse(e);
  }
}
