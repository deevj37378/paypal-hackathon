import { z } from "zod";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { savePaymentToken } from "@/lib/paypal/vault";
import { requireUserId } from "@/lib/session";

const Body = z.object({ vaultSetupToken: z.string().min(1).max(64) }).strict();

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { vaultSetupToken } = Body.parse(await req.json());
    const token = await savePaymentToken(userId, vaultSetupToken);
    // Never send the payment token id to the browser; it's a long-lived charge credential.
    return Response.json({ status: "SAVED", payerEmail: token.payment_source?.paypal?.email_address ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}
