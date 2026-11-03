import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { db, schema } from "@/db";
import { AgentAuthError, authenticateAgent, hashKey } from "@/lib/agents";
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
import { PurchaseInputError } from "@/lib/purchases/service";
import { RateLimitError } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

/**
 * Allowance MCP server (Streamable HTTP, stateless). Auth: `Authorization: Bearer alw_sk_…`.
 * The key is re-checked on EVERY tool call, so the owner's kill switch takes effect mid-session.
 */

type Ctx = { http?: { authInfo?: { token: string } } };

async function run(ctx: Ctx, fn: (agent: Awaited<ReturnType<typeof authenticateAgent>>) => Promise<{ summary: string; data: unknown }>) {
  try {
    const agent = await authenticateAgent(`Bearer ${ctx.http?.authInfo?.token ?? ""}`);
    const { summary, data } = await fn(agent);
    return {
      content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
      structuredContent: (data ?? {}) as Record<string, unknown>,
    };
  } catch (e) {
    const message =
      e instanceof AgentAuthError || e instanceof PurchaseInputError || e instanceof RateLimitError
        ? e.message
        : e instanceof z.ZodError
          ? `Invalid input: ${e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
          : "Something went wrong on Allowance's side. Nothing was charged.";
    if (!(e instanceof AgentAuthError || e instanceof PurchaseInputError || e instanceof RateLimitError || e instanceof z.ZodError)) {
      console.error("[mcp]", e);
    }
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "search_store",
      {
        title: "Search the store",
        description: TOOL_DESCRIPTIONS.search_store,
        inputSchema: SearchStoreInput,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input, ctx) => run(ctx as Ctx, (agent) => searchStore(agent, input)),
    );
    server.registerTool(
      "get_allowance_status",
      {
        title: "Check my spending allowance",
        description: TOOL_DESCRIPTIONS.get_allowance_status,
        inputSchema: z.object({}).strict(),
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (_input, ctx) => run(ctx as Ctx, (agent) => allowanceStatus(agent)),
    );
    server.registerTool(
      "request_purchase",
      {
        title: "Request a purchase",
        description: TOOL_DESCRIPTIONS.request_purchase,
        inputSchema: RequestPurchaseInput.extend({
          merchant_id: RequestPurchaseInput.shape.merchant_id.describe('merchant_id from search_store, e.g. "demo-store".'),
          items: RequestPurchaseInput.shape.items.describe("Items to buy: [{ product_id, quantity }]. All from the same merchant."),
          total: RequestPurchaseInput.shape.total.describe('Order total as a decimal string, e.g. "18.00". Must equal the sum of store prices.'),
          currency: RequestPurchaseInput.shape.currency.describe('Always "USD".'),
          reason: z.string().trim().min(3).max(500).describe("Why you're buying this, in a sentence the owner will see."),
          idempotency_key: RequestPurchaseInput.shape.idempotency_key.describe("Unique string per intended purchase (e.g. a UUID). Reuse it only when retrying the same purchase."),
        }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (input, ctx) => run(ctx as Ctx, (agent) => requestPurchaseTool(agent, input)),
    );
    server.registerTool(
      "get_purchase_status",
      {
        title: "Check a purchase",
        description: TOOL_DESCRIPTIONS.get_purchase_status,
        inputSchema: PurchaseStatusInput,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (input, ctx) => run(ctx as Ctx, (agent) => purchaseStatus(agent, input)),
    );
  },
  {
    serverInfo: { name: "allowance", version: "1.0.0" },
    instructions:
      "Allowance lets you spend the owner's money via PayPal within rules they set. Call get_allowance_status first, search_store to find exact product_ids, then request_purchase. Never invent prices. If a purchase is pending_approval, tell the user and check back with get_purchase_status; if blocked, explain the reason.",
  },
);

/** Unknown keys are refused at connect time (401). Revoked keys still connect but every tool call explains the revocation. */
const authed = withMcpAuth(
  handler,
  async (_req, token) => {
    if (!token?.startsWith("alw_sk_")) return undefined;
    const [agent] = await db().select({ id: schema.agents.id }).from(schema.agents).where(eq(schema.agents.keyHash, hashKey(token))).limit(1);
    if (!agent) return undefined;
    return { token, clientId: agent.id, scopes: ["allowance:purchase"] };
  },
  { required: true },
);

export { authed as GET, authed as POST, authed as DELETE };
