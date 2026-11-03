import { connection } from "next/server";
import { errorResponse } from "@/lib/http";
import { createBrowserClientToken } from "@/lib/paypal/vault";
import { requireUserId } from "@/lib/session";

export async function GET() {
  await connection(); // per-request only: never prerender a token endpoint
  try {
    await requireUserId();
    const { accessToken, expiresIn } = await createBrowserClientToken();
    return Response.json({ accessToken, expiresIn }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
