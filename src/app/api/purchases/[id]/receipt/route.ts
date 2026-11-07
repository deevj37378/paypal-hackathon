import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { errorResponse } from "@/lib/http";
import { issueReceipt } from "@/lib/mandates/receipts";
import { requireUserId } from "@/lib/session";

/** Download the AP2-style signed receipt (compact JWS) of one of your charged purchases. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const [p] = await db()
      .select({ status: schema.purchases.status, receiptId: schema.purchases.receiptId, receiptJws: schema.purchases.receiptJws })
      .from(schema.purchases)
      .where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, userId)))
      .limit(1);
    if (!p) return Response.json({ error: "not_found", message: "Purchase not found." }, { status: 404 });
    // Captured before receipts existed (or signing hiccup): issue it now.
    const jws = p.receiptJws ?? (p.status === "captured" ? await issueReceipt(id) : null);
    if (!jws) return Response.json({ error: "not_found", message: "Only charged purchases have a signed receipt." }, { status: 404 });
    return new Response(jws + "\n", {
      headers: {
        "Content-Type": "application/jose",
        "Content-Disposition": `attachment; filename="${p.receiptId ?? "receipt"}.jws"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
