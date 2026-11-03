import { assertSameOrigin, errorResponse } from "@/lib/http";
import { setSessionCookie } from "@/lib/session";
import { createUser } from "@/lib/users";

/** "Get started": creates a fresh account with the starter rules and signs this browser in. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await createUser();
    await setSessionCookie(userId);
    return new Response(null, { status: 303, headers: { Location: "/link-paypal" } });
  } catch (e) {
    return errorResponse(e);
  }
}
