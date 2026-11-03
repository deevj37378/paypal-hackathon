import { assertSameOrigin, errorResponse } from "@/lib/http";
import { createSetupToken } from "@/lib/paypal/vault";
import { requireUserId } from "@/lib/session";
import { getActiveVault } from "@/lib/users";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const existing = await getActiveVault(userId);
    const token = await createSetupToken({ paypalCustomerId: existing?.paypalCustomerId ?? undefined });
    return Response.json({ id: token.id, status: token.status });
  } catch (e) {
    return errorResponse(e);
  }
}
