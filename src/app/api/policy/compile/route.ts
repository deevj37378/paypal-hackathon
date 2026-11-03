import { z } from "zod";
import { compileRules } from "@/lib/ai/compile";
import { diffRules } from "@/lib/policy/describe";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { requireUserId } from "@/lib/session";
import { getActivePolicy } from "@/lib/users";

const Body = z.object({ text: z.string().trim().min(5).max(1000) }).strict();

/** Plain English → proposed rules + diff. Never activates anything. */
export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const userId = await requireUserId();
    const { text } = Body.parse(await req.json());
    const result = await compileRules(userId, text);
    if (result.kind !== "rules") return Response.json(result);
    const current = await getActivePolicy(userId);
    return Response.json({ ...result, cards: diffRules(current?.rules ?? null, result.rules) });
  } catch (e) {
    return errorResponse(e);
  }
}
