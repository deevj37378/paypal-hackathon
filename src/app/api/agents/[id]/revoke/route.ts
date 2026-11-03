import { revokeAgent } from "@/lib/agents";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

/** Kill switch. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { id } = await params;
    const ok = await revokeAgent(userId, id);
    return Response.json({ revoked: ok }, { status: ok ? 200 : 404 });
  } catch (e) {
    return errorResponse(e);
  }
}
