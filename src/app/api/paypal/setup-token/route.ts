import { createSetupToken } from "@/lib/paypal/vault";
import { errorResponse } from "@/lib/http";

export async function POST() {
  try {
    const token = await createSetupToken();
    return Response.json({ id: token.id, status: token.status });
  } catch (e) {
    return errorResponse(e);
  }
}
