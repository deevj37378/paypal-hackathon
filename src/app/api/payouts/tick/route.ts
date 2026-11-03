import { assertSameOrigin, errorResponse } from "@/lib/http";
import { processDuePayouts } from "@/lib/purchases/payouts";
import { expireStaleApprovals, failStaleProcessing } from "@/lib/purchases/service";
import { requireUserId } from "@/lib/session";

/** Called by the dashboard while open: settles this user's due payouts and expires stale approvals. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    await expireStaleApprovals(userId);
    await failStaleProcessing();
    const result = await processDuePayouts({ userId, limit: 5 });
    return Response.json(result);
  } catch (e) {
    return errorResponse(e);
  }
}
