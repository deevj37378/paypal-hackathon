import { z } from "zod";
import { validateGrant } from "@/lib/ai/compile-grant";
import { createGrant } from "@/lib/allowances";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { requireUserId } from "@/lib/session";

const slug = z.string().trim().toLowerCase().max(40).regex(/^[a-z0-9][a-z0-9-]*$/);
const Body = z
  .object({
    description: z.string().trim().min(3).max(200),
    amountCents: z.number().int(),
    category: slug.nullable(),
    merchantId: slug.nullable(),
    expiresAt: z.string().datetime(),
  })
  .strict();

/** The owner confirms a one-time allowance: only this creates it. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    await rateLimit(`grant:${userId}`, 20, 3600, "one-time allowances");
    const b = Body.parse(await req.json());
    const expiresAt = new Date(b.expiresAt);
    const problem = validateGrant({ amountCents: b.amountCents, expiresAt });
    if (problem) return Response.json({ error: "invalid_request", message: problem }, { status: 400 });
    const g = await createGrant(userId, { ...b, expiresAt });
    return Response.json({ id: g.id }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
