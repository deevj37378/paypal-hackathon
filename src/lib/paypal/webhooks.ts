import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { formatUsd } from "@/lib/money";
import { logEvent } from "@/lib/purchases/events";
import { notifyPurchase } from "@/lib/purchases/notify";
import { markCaptured, recordExternalRefund } from "@/lib/purchases/service";
import { getAccessToken } from "./client";

/** Events Allowance subscribes to (sandbox webhook on the live URL). */
export const WEBHOOK_EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.CAPTURE.REVERSED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
] as const;

/**
 * Verify a delivery with PayPal's verify-webhook-signature API.
 * The raw body is embedded verbatim (not re-serialised) so the signed bytes match exactly.
 * Docs: https://developer.paypal.com/api/webhooks/v1/definitions/verify_webhook_signature
 */
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = env().PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (k: string) => headers.get(k);
  const fields = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
  };
  if (Object.values(fields).some((v) => !v)) return false;
  const body = `{${Object.entries(fields)
    .map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
    .join(",")},"webhook_event":${rawBody}}`;
  const res = await fetch(`${env().PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
    body,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { verification_status?: string };
  return res.ok && data.verification_status === "SUCCESS";
}

type Event = {
  id: string;
  event_type: string;
  resource: {
    id?: string;
    custom_id?: string;
    status?: string;
    supplementary_data?: { related_ids?: { order_id?: string } };
    links?: { href: string; rel: string }[];
    payout_item?: { sender_item_id?: string };
    transaction_status?: string;
  };
};

/** Apply one verified event. Idempotent per event id. Returns a short outcome string for logs. */
export async function handleWebhookEvent(event: Event): Promise<string> {
  const [fresh] = await db()
    .insert(schema.webhookEvents)
    .values({ id: `paypal:${event.id}`, source: "paypal", type: event.event_type })
    .onConflictDoNothing()
    .returning({ id: schema.webhookEvents.id });
  if (!fresh) return "duplicate";

  const r = event.resource;
  let purchaseId: string | undefined;
  let outcome = "ignored";

  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      purchaseId = r.custom_id;
      if (purchaseId && r.id) {
        const before = await getPurchase(purchaseId);
        const after = await markCaptured(purchaseId, { orderId: r.supplementary_data?.related_ids?.order_id, captureId: r.id }, "PayPal confirmed");
        if (before && after && before.status !== "captured" && after.status === "captured") {
          outcome = "reconciled: captured";
          await notifyPurchase(after);
        } else outcome = "confirmed";
      }
      break;
    }
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.REVERSED": {
      purchaseId = r.custom_id;
      if (purchaseId) {
        const [p] = await db()
          .update(schema.purchases)
          .set({ status: "failed", failureReason: `PayPal: ${event.event_type.split(".").pop()!.toLowerCase()}`, updatedAt: new Date() })
          .where(and(eq(schema.purchases.id, purchaseId), inArray(schema.purchases.status, ["processing", "captured"])))
          .returning();
        if (p) {
          await db()
            .update(schema.purchases)
            .set({ payoutStatus: "cancelled" })
            .where(and(eq(schema.purchases.id, p.id), eq(schema.purchases.payoutStatus, "scheduled")));
          await logEvent(p.id, "failed", `PayPal reported the payment ${event.event_type.endsWith("DENIED") ? "denied" : "reversed"}.`);
          await notifyPurchase(p);
          outcome = "marked failed";
        }
      }
      break;
    }
    case "PAYMENT.CAPTURE.PENDING": {
      purchaseId = r.custom_id;
      if (purchaseId) await logEvent(purchaseId, "capture_pending", "PayPal is still processing this payment.");
      outcome = "noted";
      break;
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      // resource is the refund; its "up" link points at the capture.
      const captureId = r.links?.find((l) => l.rel === "up")?.href.split("/").pop();
      if (captureId && r.id) {
        const p = await recordExternalRefund(captureId, r.id);
        purchaseId = p?.id;
        outcome = p ? `refund recorded (${p.status})` : "unknown capture";
      }
      break;
    }
    default: {
      if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
        purchaseId = r.payout_item?.sender_item_id;
        const kind = event.event_type.split(".").pop()!;
        const status = kind === "SUCCEEDED" ? "paid" : ["FAILED", "RETURNED", "BLOCKED", "CANCELED", "REFUNDED"].includes(kind) ? "failed" : null;
        if (purchaseId && status) {
          const [p] = await db()
            .update(schema.purchases)
            .set({ payoutStatus: status, updatedAt: new Date() })
            .where(and(eq(schema.purchases.id, purchaseId), inArray(schema.purchases.payoutStatus, ["processing", "sent", "paid"])))
            .returning();
          if (p) {
            await logEvent(
              p.id,
              status === "paid" ? "payout_paid" : "payout_failed",
              status === "paid"
                ? `PayPal confirmed the merchant received ${formatUsd(p.payoutCents ?? p.totalCents)}.`
                : `Merchant payout ${kind.toLowerCase()} (PayPal). The money stays with Allowance.`,
            );
            outcome = `payout ${status}`;
          }
        } else if (purchaseId) {
          await logEvent(purchaseId, "payout_update", `PayPal payout update: ${kind.toLowerCase()}.`);
          outcome = "noted";
        }
      }
    }
  }

  await db().update(schema.webhookEvents).set({ purchaseId: purchaseId ?? null, outcome }).where(eq(schema.webhookEvents.id, `paypal:${event.id}`));
  return outcome;
}

async function getPurchase(id: string) {
  const [p] = await db().select().from(schema.purchases).where(eq(schema.purchases.id, id)).limit(1);
  return p ?? null;
}
