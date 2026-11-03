import { db, schema } from "@/db";
import { newId } from "@/lib/ids";

export async function logEvent(purchaseId: string, type: string, message: string, data?: unknown) {
  await db()
    .insert(schema.purchaseEvents)
    .values({ id: newId("evt"), purchaseId, type, message, data: data ?? null });
}
