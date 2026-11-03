import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    await db().update(schema.users).set({ telegramChatId: null, telegramUsername: null }).where(eq(schema.users.id, userId));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
