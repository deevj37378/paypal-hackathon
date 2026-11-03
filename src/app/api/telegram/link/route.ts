import { assertSameOrigin, errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/session";
import { createLinkCode, telegramEnabled } from "@/lib/telegram";

/** Creates a one-time t.me deep link that connects this account's Telegram chat. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    if (!telegramEnabled()) return Response.json({ error: "unavailable", message: "Telegram isn't configured." }, { status: 503 });
    await rateLimit(`tg-link:${userId}`, 10, 3600, "Telegram links");
    const link = await createLinkCode(userId);
    return Response.json(link, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
