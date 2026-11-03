import { z } from "zod";
import { savePaymentToken } from "@/lib/paypal/vault";
import { ensureSpikeUser } from "@/lib/spike-user";
import { errorResponse } from "@/lib/http";

const Body = z.object({ vaultSetupToken: z.string().min(1).max(64) });

export async function POST(req: Request) {
  try {
    const { vaultSetupToken } = Body.parse(await req.json());
    const userId = await ensureSpikeUser();
    const token = await savePaymentToken(userId, vaultSetupToken);
    // Never send the payment token id to the browser; it's a long-lived charge credential.
    return Response.json({
      status: "SAVED",
      payerEmail: token.payment_source?.paypal?.email_address ?? null,
      customerId: token.customer?.id ?? null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
