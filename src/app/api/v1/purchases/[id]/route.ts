import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { authenticateAgent } from "@/lib/agents";
import { errorResponse } from "@/lib/http";
import { toAgentView } from "@/lib/purchases/service";

/** Agent REST API: get_purchase_status. Agents only see purchases they made. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const agent = await authenticateAgent(req.headers.get("authorization"));
    const { id } = await params;
    const [p] = await db()
      .select()
      .from(schema.purchases)
      .where(and(eq(schema.purchases.id, id), eq(schema.purchases.agentId, agent.id)))
      .limit(1);
    if (!p) return Response.json({ error: "not_found", message: "No such purchase for this agent." }, { status: 404 });
    return Response.json(toAgentView(p));
  } catch (e) {
    return errorResponse(e);
  }
}
