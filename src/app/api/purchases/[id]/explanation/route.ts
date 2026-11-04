import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { explainDecision } from "@/lib/ai/explain";
import { errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

/**
 * Plain-English explanation for one of the user's purchases. Fetched by the browser after the
 * detail page opens, so route prefetching can never cut the AI call short.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const [p] = await db()
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, userId)))
      .limit(1);
    if (!p) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(await explainDecision(p), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
