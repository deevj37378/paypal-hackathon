import { cancelGrant } from "@/lib/allowances";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { id } = await params;
    const g = await cancelGrant(userId, id);
    if (!g) return Response.json({ error: "not_found", message: "Not found, or already used." }, { status: 404 });
    return Response.json({ id, cancelled: true });
  } catch (e) {
    return errorResponse(e);
  }
}
