import { assertSameOrigin, errorResponse } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { setSessionCookie } from "@/lib/session";
import { cleanupExpiredDemos, createUser } from "@/lib/users";

/** "Try the demo": a 24-hour account with the default rules and the shared pre-linked sandbox buyer. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await rateLimit(`demo:ip:${clientIp(req)}`, 10, 3600, "demo accounts from this network");
    await rateLimit("demo:global", 500, 86_400, "demo accounts today");
    await cleanupExpiredDemos().catch((e) => console.error("[demo cleanup]", e));
    const userId = await createUser({ isDemo: true, name: "Demo" });
    await setSessionCookie(userId);
    return new Response(null, { status: 303, headers: { Location: "/dashboard?tour=1" } });
  } catch (e) {
    return errorResponse(e);
  }
}
