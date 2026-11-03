import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import { withUserLock } from "@/db/tx";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { newId } from "@/lib/ids";
import { PolicyRules } from "@/lib/policy/schema";
import { rateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/session";

const Body = z.object({ rules: PolicyRules, sourceText: z.string().trim().max(1000).nullable() }).strict();

/** The human confirmation step: only this activates rules. Old rules are archived, never deleted. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    await rateLimit(`policy:${userId}`, 30, 3600, "rule changes");
    const { rules, sourceText } = Body.parse(await req.json());
    if (rules.perOrderLimitCents !== null && rules.perOrderLimitCents > rules.monthlyLimitCents) {
      return Response.json({ error: "invalid_request", message: "The per-order limit can't be bigger than the monthly limit." }, { status: 400 });
    }
    const id = newId("pol");
    // Same lock as purchases: a request never sees "no active rules" or a half-applied swap.
    await withUserLock(userId, async (tx) => {
      await tx
        .update(schema.policies)
        .set({ status: "archived" })
        .where(and(eq(schema.policies.userId, userId), eq(schema.policies.status, "active")));
      await tx.insert(schema.policies).values({ id, userId, rules, sourceText, status: "active" });
    });
    return Response.json({ id, status: "active" });
  } catch (e) {
    return errorResponse(e);
  }
}
