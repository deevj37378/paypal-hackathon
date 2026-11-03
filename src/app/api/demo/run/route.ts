import { z } from "zod";
import { getBuiltinAgent } from "@/lib/agents";
import { requestPurchaseTool } from "@/lib/agent/tools";
import { DEMO_SCENARIOS } from "@/lib/demo";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/session";

const Body = z.object({ scenario: z.enum(Object.keys(DEMO_SCENARIOS) as [keyof typeof DEMO_SCENARIOS]) }).strict();

/** Runs one guided scenario through the real agent purchase path (same as MCP request_purchase). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    await rateLimit(`demo-run:${userId}`, 30, 3600, "demo runs");
    const { scenario } = Body.parse(await req.json());
    const agent = await getBuiltinAgent(userId, { create: true });
    if (!agent || agent.status !== "active") {
      return Response.json({ error: "revoked", message: "You revoked the built-in agent (kill switch), so it can't buy anything." }, { status: 403 });
    }
    const { summary, data } = await requestPurchaseTool(agent, { ...DEMO_SCENARIOS[scenario].input, idempotency_key: crypto.randomUUID() });
    return Response.json({ summary, ...data });
  } catch (e) {
    return errorResponse(e);
  }
}
