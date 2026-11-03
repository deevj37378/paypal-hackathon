import { z } from "zod";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { decidePurchase } from "@/lib/purchases/service";
import { requireUserId } from "@/lib/session";

const Body = z.object({ approve: z.boolean() }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { id } = await params;
    const { approve } = Body.parse(await req.json());
    const p = await decidePurchase({ userId, purchaseId: id, approve, via: "dashboard" });
    return Response.json({ id: p.id, status: p.status });
  } catch (e) {
    return errorResponse(e);
  }
}
