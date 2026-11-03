import { createBuiltinAgent, getBuiltinAgent } from "@/lib/agents";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

/** Turn the built-in agent back on after a kill-switch revoke (explicit owner action only). */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const current = await getBuiltinAgent(userId);
    if (current?.status === "active") return Response.json({ id: current.id, status: "active" });
    const agent = await createBuiltinAgent(userId);
    return Response.json({ id: agent.id, status: agent.status });
  } catch (e) {
    return errorResponse(e);
  }
}
