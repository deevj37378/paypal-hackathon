import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { errorResponse } from "@/lib/http";
import { signingConfigured } from "@/lib/mandates/keys";
import { intentMandateForGrant, intentMandateForPolicy, mandateHash, sign } from "@/lib/mandates/mandate";
import { merchantNames } from "@/lib/mandates/receipts";
import { requireUserId } from "@/lib/session";
import { connection } from "next/server";
import { getActivePolicy } from "@/lib/users";

/**
 * Export the owner's active rules (or one one-time allowance, ?grant=<id>) as an AP2-style signed
 * IntentMandate: { mandate (claims), jws (compact, ES256), hash, jwks_url }.
 */
export async function GET(req: Request) {
  await connection(); // per-request (outside try: it signals Next not to prerender this route)
  try {
    const userId = await requireUserId();
    if (!signingConfigured()) return Response.json({ error: "unavailable", message: "Mandate signing isn't configured on this server." }, { status: 503 });
    const names = await merchantNames();
    const grantId = new URL(req.url).searchParams.get("grant");
    let claims;
    if (grantId) {
      const [g] = await db()
        .select()
        .from(schema.oneTimeAllowances)
        .where(and(eq(schema.oneTimeAllowances.id, grantId), eq(schema.oneTimeAllowances.userId, userId)))
        .orderBy(desc(schema.oneTimeAllowances.createdAt))
        .limit(1);
      if (!g) return Response.json({ error: "not_found", message: "One-time allowance not found." }, { status: 404 });
      claims = intentMandateForGrant(g, names);
    } else {
      const policy = await getActivePolicy(userId);
      if (!policy) return Response.json({ error: "not_found", message: "No active rules to export." }, { status: 404 });
      claims = intentMandateForPolicy(policy, new Date(), names);
    }
    const jws = await sign(claims, "ap2-intent-mandate+jwt");
    const origin = new URL(req.url).origin;
    const body = { format: "AP2-style signed IntentMandate (compact JWS, ES256)", hash: mandateHash(claims), jwks_url: `${origin}/.well-known/jwks.json`, verify_url: `${origin}/verify`, mandate: claims, jws };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="allowance-intent-mandate${grantId ? `-${grantId}` : ""}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
