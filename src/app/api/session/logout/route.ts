import { assertSameOrigin, errorResponse } from "@/lib/http";
import { clearSessionCookie } from "@/lib/session";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await clearSessionCookie();
    return new Response(null, { status: 303, headers: { Location: "/" } });
  } catch (e) {
    return errorResponse(e);
  }
}
