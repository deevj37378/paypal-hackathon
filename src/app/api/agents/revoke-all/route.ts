import { revokeAllAgents } from "@/lib/agents";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

/** Big red button: every agent key for this user stops working on its next request. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    return Response.json({ revoked: await revokeAllAgents(userId) });
  } catch (e) {
    return errorResponse(e);
  }
}
