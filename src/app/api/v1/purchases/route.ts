import { after } from "next/server";
import { authenticateAgent } from "@/lib/agents";
import { env } from "@/lib/env";
import { errorResponse } from "@/lib/http";
import { processDuePayouts } from "@/lib/purchases/payouts";
import { requestPurchase, toAgentView } from "@/lib/purchases/service";

/**
 * Agent REST API: request_purchase. (The MCP tool in M3 calls the same service.)
 *   Authorization: Bearer alw_sk_…
 *   { merchant_id, items: [{ product_id, quantity }], total: "18.00", currency: "USD", reason?, idempotency_key? }
 */
export async function POST(req: Request) {
  try {
    const agent = await authenticateAgent(req.headers.get("authorization"));
    const purchase = await requestPurchase(agent, await req.json().catch(() => null));
    if (purchase.payoutStatus === "scheduled" && env().PAYOUT_HOLD_SECONDS === 0) {
      after(() => processDuePayouts({ userId: purchase.userId, limit: 3 }));
    }
    const view = toAgentView(purchase);
    return Response.json(view, { status: view.status === "blocked" || view.status === "failed" ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
