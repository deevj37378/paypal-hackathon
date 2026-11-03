import { centsToValue } from "@/lib/money";
import { paypalFetch } from "./client";

/**
 * Money movement against PayPal (sandbox). Every POST carries a stable PayPal-Request-Id
 * derived from our purchase id, so retries can never double-charge, double-refund or double-pay.
 */

type Capture = { id: string; status: string };
type Order = { id: string; status: string; purchase_units?: { payments?: { captures?: Capture[] } }[] };

/**
 * Merchant-initiated charge of a vaulted PayPal wallet (no buyer present).
 * Docs: https://developer.paypal.com/api/payment-tokens/save-without-purchase/paypal (step 4)
 * stored_credential: Orders v2 `paypal_wallet_stored_credential` schema.
 */
export async function chargeVaultedWallet(opts: {
  purchaseId: string;
  vaultId: string;
  amountCents: number;
  description: string;
  items: { name: string; quantity: number; unitPriceCents: number; category: string }[];
}) {
  const value = centsToValue(opts.amountCents);
  let order = await paypalFetch<Order>("/v2/checkout/orders", {
    requestId: `order-${opts.purchaseId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: opts.purchaseId,
          custom_id: opts.purchaseId,
          description: opts.description.slice(0, 127),
          amount: {
            currency_code: "USD",
            value,
            breakdown: { item_total: { currency_code: "USD", value } },
          },
          items: opts.items.map((i) => ({
            name: i.name.slice(0, 127),
            quantity: String(i.quantity),
            unit_amount: { currency_code: "USD", value: centsToValue(i.unitPriceCents) },
            category: "PHYSICAL_GOODS",
          })),
        },
      ],
      payment_source: {
        paypal: {
          vault_id: opts.vaultId,
          stored_credential: {
            payment_initiator: "MERCHANT",
            usage: "SUBSEQUENT",
            usage_pattern: "UNSCHEDULED_PREPAID",
          },
        },
      },
    },
  });
  // Vaulted PayPal orders usually come back COMPLETED; capture explicitly if not.
  if (order.status !== "COMPLETED") {
    order = await paypalFetch<Order>(`/v2/checkout/orders/${order.id}/capture`, {
      requestId: `capture-${opts.purchaseId}`,
      body: {},
    });
  }
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  return { orderId: order.id, orderStatus: order.status, captureId: capture?.id, captureStatus: capture?.status };
}

export async function refundCapture(opts: { purchaseId: string; captureId: string }) {
  return paypalFetch<{ id: string; status: string }>(`/v2/payments/captures/${opts.captureId}/refund`, {
    requestId: `refund-${opts.purchaseId}`,
    body: { note_to_payer: "Refunded via Allowance" },
  });
}

type PayoutBatch = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { transaction_status?: string; errors?: { name: string; message: string } }[];
};

/** Docs: https://developer.paypal.com/api/payouts */
export async function sendPayout(opts: { purchaseId: string; receiverEmail: string; amountCents: number; note: string }) {
  return paypalFetch<PayoutBatch>("/v1/payments/payouts", {
    requestId: `payout-${opts.purchaseId}`,
    body: {
      sender_batch_header: {
        sender_batch_id: `payout-${opts.purchaseId}`, // PayPal dedupes on this for 30 days
        email_subject: "You made a sale through Allowance",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: opts.receiverEmail,
          amount: { value: centsToValue(opts.amountCents), currency: "USD" },
          note: opts.note.slice(0, 4000),
          sender_item_id: opts.purchaseId,
        },
      ],
    },
  });
}

export async function getPayoutBatch(batchId: string) {
  return paypalFetch<PayoutBatch>(`/v1/payments/payouts/${batchId}`);
}
