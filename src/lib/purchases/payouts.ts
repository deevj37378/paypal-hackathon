import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { PayPalError } from "@/lib/paypal/client";
import { getPayoutBatch, sendPayout } from "@/lib/paypal/payments";
import { logEvent } from "./events";

/**
 * Settlement-window payout worker. Runs opportunistically (after captures, on dashboard refresh)
 * and from Vercel Cron as a backstop. Safe to run concurrently: each payout is claimed with a
 * conditional UPDATE, and PayPal dedupes on sender_batch_id.
 */
export async function processDuePayouts(opts: { userId?: string; limit?: number } = {}) {
  const due = await db()
    .select({ id: schema.purchases.id })
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.payoutStatus, "scheduled"),
        lte(schema.purchases.payoutDueAt, new Date()),
        opts.userId ? eq(schema.purchases.userId, opts.userId) : undefined,
      ),
    )
    .limit(opts.limit ?? 10);

  let sent = 0;
  for (const { id } of due) {
    const [p] = await db()
      .update(schema.purchases)
      .set({ payoutStatus: "processing", updatedAt: new Date() })
      .where(and(eq(schema.purchases.id, id), eq(schema.purchases.payoutStatus, "scheduled")))
      .returning();
    if (!p) continue; // someone else (or a refund) got it first

    const [merchant] = await db().select().from(schema.merchants).where(eq(schema.merchants.id, p.merchantId)).limit(1);

    // Net any clawback from earlier refunds against this payout.
    const offset = Math.min(merchant.clawbackCents, p.totalCents);
    if (offset > 0) {
      await db()
        .update(schema.merchants)
        .set({ clawbackCents: sql`greatest(${schema.merchants.clawbackCents} - ${offset}, 0)` })
        .where(eq(schema.merchants.id, merchant.id));
    }
    const amount = p.totalCents - offset;

    if (amount === 0) {
      await db()
        .update(schema.purchases)
        .set({ payoutStatus: "paid", payoutCents: 0, updatedAt: new Date() })
        .where(eq(schema.purchases.id, p.id));
      await logEvent(p.id, "payout_paid", `Payout fully offset by ${formatUsd(offset)} owed from an earlier refund.`);
      continue;
    }

    try {
      const batch = await sendPayout({
        purchaseId: p.id,
        receiverEmail: merchant.payoutEmail,
        amountCents: amount,
        note: `Agent purchase ${p.id} via Allowance`,
      });
      const status = mapBatch(batch.batch_header.batch_status);
      await db()
        .update(schema.purchases)
        .set({ payoutStatus: status, payoutCents: amount, payoutBatchId: batch.batch_header.payout_batch_id, updatedAt: new Date() })
        .where(eq(schema.purchases.id, p.id));
      await logEvent(
        p.id,
        status === "paid" ? "payout_paid" : "payout_sent",
        `${status === "paid" ? "Paid" : "Sending"} ${formatUsd(amount)} to ${merchant.name}${offset ? ` (${formatUsd(offset)} withheld for an earlier refund)` : ""}.`,
        { batchId: batch.batch_header.payout_batch_id },
      );
      sent++;
    } catch (e) {
      // Give the clawback back and leave it scheduled for a retry.
      if (offset > 0) {
        await db()
          .update(schema.merchants)
          .set({ clawbackCents: sql`${schema.merchants.clawbackCents} + ${offset}` })
          .where(eq(schema.merchants.id, merchant.id));
      }
      await db()
        .update(schema.purchases)
        .set({ payoutStatus: "scheduled", updatedAt: new Date() })
        .where(eq(schema.purchases.id, p.id));
      console.error(`[payouts] ${p.id} failed`, e instanceof PayPalError ? `${e.message} debug_id=${e.debugId}` : e);
    }
  }

  await confirmSentPayouts(opts.userId);
  return { due: due.length, sent };
}

/** Poll batches that PayPal accepted but hadn't finished (webhooks take over in M4). */
async function confirmSentPayouts(userId?: string) {
  const pending = await db()
    .select()
    .from(schema.purchases)
    .where(and(eq(schema.purchases.payoutStatus, "sent"), userId ? eq(schema.purchases.userId, userId) : undefined))
    .limit(10);
  for (const p of pending) {
    if (!p.payoutBatchId) continue;
    try {
      const batch = await getPayoutBatch(p.payoutBatchId);
      const status = mapBatch(batch.batch_header.batch_status);
      if (status === "sent") continue;
      const [changed] = await db()
        .update(schema.purchases)
        .set({ payoutStatus: status, updatedAt: new Date() })
        .where(and(eq(schema.purchases.id, p.id), inArray(schema.purchases.payoutStatus, ["sent"])))
        .returning({ id: schema.purchases.id });
      if (changed) {
        await logEvent(
          p.id,
          status === "paid" ? "payout_paid" : "payout_failed",
          status === "paid" ? `Merchant received ${formatUsd(p.payoutCents ?? p.totalCents)}.` : "Merchant payout failed.",
        );
      }
    } catch (e) {
      console.error(`[payouts] confirm ${p.id} failed`, e);
    }
  }
}

function mapBatch(s: string): "paid" | "sent" | "failed" {
  if (s === "SUCCESS") return "paid";
  if (s === "DENIED" || s === "CANCELED") return "failed";
  return "sent";
}
