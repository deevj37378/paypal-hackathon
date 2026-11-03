import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { refundPurchase } from "@/lib/purchases/service";
(async () => {
  const id = process.argv[2];
  const [before] = await db().select().from(schema.purchases).where(eq(schema.purchases.id, id));
  console.log("before:", before.status, "payout:", before.payoutStatus, "capture:", before.paypalCaptureId);
  const after = await refundPurchase({ userId: before.userId, purchaseId: id });
  console.log("after: ", after.status, "payout:", after.payoutStatus, "refund:", after.paypalRefundId);
  const [m] = await db().select().from(schema.merchants).where(eq(schema.merchants.id, before.merchantId));
  console.log("merchant clawback cents:", m.clawbackCents);
  const ev = await db().select().from(schema.purchaseEvents).where(eq(schema.purchaseEvents.purchaseId, id)).orderBy(schema.purchaseEvents.createdAt);
  for (const e of ev) console.log("  •", e.type, "-", e.message);
  process.exit(0);
})();
