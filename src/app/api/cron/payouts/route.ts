import { env } from "@/lib/env";
import { errorResponse } from "@/lib/http";
import { processDuePayouts } from "@/lib/purchases/payouts";
import { pruneRateLimits } from "@/lib/rate-limit";
import { expireStaleApprovals, failStaleProcessing } from "@/lib/purchases/service";

/** Vercel Cron backstop (Authorization: Bearer $CRON_SECRET). */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await expireStaleApprovals();
    await failStaleProcessing();
    await pruneRateLimits();
    return Response.json(await processDuePayouts({ limit: 25 }));
  } catch (e) {
    return errorResponse(e);
  }
}
