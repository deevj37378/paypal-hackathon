import { z } from "zod";
import { errorResponse } from "@/lib/http";
import { verifyToken } from "@/lib/mandates/mandate";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const Body = z.object({ token: z.string().trim().min(20).max(20_000) }).strict();

/** Public: verify an Allowance mandate or receipt (signature, issuer, expiry) and return its contents. */
export async function POST(req: Request) {
  try {
    await rateLimit(`verify:${clientIp(req)}`, 60, 3600, "verifications");
    const { token } = Body.parse(await req.json());
    return Response.json(await verifyToken(token));
  } catch (e) {
    return errorResponse(e);
  }
}
