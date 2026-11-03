import { assertSameOrigin, errorResponse } from "@/lib/http";
import { refundPurchase } from "@/lib/purchases/service";
import { requireUserId } from "@/lib/session";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { id } = await params;
    const p = await refundPurchase({ userId, purchaseId: id });
    return Response.json({ id: p.id, status: p.status, payoutStatus: p.payoutStatus });
  } catch (e) {
    return errorResponse(e);
  }
}
