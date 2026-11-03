import { createBrowserClientToken } from "@/lib/paypal/vault";
import { errorResponse } from "@/lib/http";

export async function GET() {
  try {
    const { accessToken, expiresIn } = await createBrowserClientToken();
    return Response.json({ accessToken, expiresIn }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
