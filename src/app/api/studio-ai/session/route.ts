import { assertSameOriginStrict, errorResponse } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { issueStudioSession } from "@/lib/studio-session";

/** Called by /store/analytics on load: issues the per-browser session the AI bridge requires. */
export async function POST(req: Request) {
  try {
    assertSameOriginStrict(req);
    await rateLimit(`studio-session:ip:${clientIp(req)}`, 30, 3600, "dashboard sessions");
    await issueStudioSession();
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
