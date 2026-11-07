import { z } from "zod";
import { compileGrant } from "@/lib/ai/compile-grant";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";

const Body = z.object({ text: z.string().trim().min(5).max(500), tzOffset: z.number().int().min(-900).max(900) }).strict();

/** Plain English → one-time allowance draft. Creates nothing. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { text, tzOffset } = Body.parse(await req.json());
    return Response.json(await compileGrant(userId, text, tzOffset));
  } catch (e) {
    return errorResponse(e);
  }
}
