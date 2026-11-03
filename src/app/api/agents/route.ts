import { z } from "zod";
import { createAgent } from "@/lib/agents";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

const Body = z.object({ name: z.string().trim().min(1).max(60) }).strict();

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { name } = Body.parse(await req.json());
    const { agent, key } = await createAgent(userId, name);
    return Response.json(
      { id: agent.id, name: agent.name, keyPrefix: agent.keyPrefix, key },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
