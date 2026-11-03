/**
 * M1 Vault spike: prove a merchant-initiated charge against a vaulted PayPal wallet,
 * with NO buyer interaction, then pay the demo store and refund.
 *
 *   npm run spike:charge            # charge $18.00, pay out, refund
 *   npm run spike:charge -- 32.00   # custom amount
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { paypalFetch, PayPalError } from "@/lib/paypal/client";
import { SPIKE_USER_ID } from "@/lib/spike-user";

type Capture = { id: string; status: string; amount: { value: string; currency_code: string } };
type Order = {
  id: string;
  status: string;
  payment_source?: { paypal?: { email_address?: string } };
  purchase_units?: { payments?: { captures?: Capture[] } }[];
};
type PayoutBatch = {
  batch_header: { payout_batch_id: string; batch_status: string };
  items?: { transaction_status: string; payout_item_id: string; errors?: { name: string; message: string } }[];
};

const step = (n: number, msg: string) => console.log(`\n[${n}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const amount = process.argv[2] ?? "18.00";
  if (!/^\d+\.\d{2}$/.test(amount)) throw new Error(`Amount must look like 18.00, got ${amount}`);
  const runId = randomUUID().slice(0, 8);
  const { STORE_PAYPAL_EMAIL } = env();

  step(1, "Load the vaulted PayPal wallet");
  const [vault] = await db()
    .select()
    .from(schema.paypalVaults)
    .where(and(eq(schema.paypalVaults.userId, SPIKE_USER_ID), eq(schema.paypalVaults.status, "active")))
    .orderBy(desc(schema.paypalVaults.createdAt))
    .limit(1);
  if (!vault) throw new Error("No vaulted wallet. Open http://localhost:3100/spike/vault and link PayPal first.");
  console.log(`    payer=${vault.payerEmail} customer=${vault.paypalCustomerId} token=${vault.paymentTokenId.slice(0, 4)}…`);

  step(2, `Create order for $${amount} with vault_id (no buyer present)`);
  let order = await paypalFetch<Order>("/v2/checkout/orders", {
    requestId: `spike-order-${runId}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `spike-${runId}`,
          description: "Allowance M1 spike: agent purchase",
          amount: { currency_code: "USD", value: amount },
        },
      ],
      payment_source: { paypal: { vault_id: vault.paymentTokenId } },
    },
  });
  console.log(`    order=${order.id} status=${order.status}`);

  if (order.status !== "COMPLETED") {
    step(2.5, `Order is ${order.status}; capturing`);
    order = await paypalFetch<Order>(`/v2/checkout/orders/${order.id}/capture`, {
      requestId: `spike-capture-${runId}`,
      body: {},
    });
    console.log(`    order=${order.id} status=${order.status}`);
  }
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture || capture.status !== "COMPLETED") {
    throw new Error(`Capture not completed: ${JSON.stringify(capture ?? order.status)}`);
  }
  console.log(`    ✓ capture=${capture.id} status=${capture.status} ${capture.amount.value} ${capture.amount.currency_code}`);

  step(3, `Payout $${amount} to the demo store (${STORE_PAYPAL_EMAIL})`);
  const batch = await paypalFetch<PayoutBatch>("/v1/payments/payouts", {
    requestId: `spike-payout-${capture.id}`,
    body: {
      sender_batch_header: {
        sender_batch_id: `spike-${capture.id}`, // one payout per capture, retry-safe
        email_subject: "You made a sale through Allowance",
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: STORE_PAYPAL_EMAIL,
          amount: { value: amount, currency: "USD" },
          note: `Agent purchase, capture ${capture.id}`,
          sender_item_id: capture.id,
        },
      ],
    },
  });
  const batchId = batch.batch_header.payout_batch_id;
  console.log(`    batch=${batchId} status=${batch.batch_header.batch_status}`);

  let payout = batch;
  for (let i = 0; i < 12 && !["SUCCESS", "DENIED", "CANCELED"].includes(payout.batch_header.batch_status); i++) {
    await sleep(5000);
    payout = await paypalFetch<PayoutBatch>(`/v1/payments/payouts/${batchId}`);
    console.log(`    …poll ${i + 1}: batch=${payout.batch_header.batch_status} item=${payout.items?.[0]?.transaction_status}`);
  }
  const item = payout.items?.[0];
  console.log(
    `    ${payout.batch_header.batch_status === "SUCCESS" ? "✓" : "!"} batch=${payout.batch_header.batch_status} item=${item?.transaction_status}${item?.errors ? ` error=${item.errors.name}` : ""}`,
  );

  step(4, "Refund the capture (proves the one-tap refund path)");
  const refund = await paypalFetch<{ id: string; status: string }>(`/v2/payments/captures/${capture.id}/refund`, {
    requestId: `spike-refund-${capture.id}`,
    body: { note_to_payer: "Allowance M1 spike refund" },
  });
  console.log(`    ${refund.status === "COMPLETED" ? "✓" : "!"} refund=${refund.id} status=${refund.status}`);

  const planA = capture.status === "COMPLETED" && payout.batch_header.batch_status === "SUCCESS";
  console.log(`\n=== RESULT: ${planA ? "PLAN A (Vault) works" : "check the output above"} ===`);
  console.log(JSON.stringify({ order: order.id, capture: capture.id, payoutBatch: batchId, payoutItem: item?.payout_item_id, refund: refund.id }, null, 2));
}

main().catch((e) => {
  if (e instanceof PayPalError) {
    console.error(`\n✗ PayPal error ${e.status} debug_id=${e.debugId}\n${e.message}\n${JSON.stringify(e.details, null, 2)}`);
  } else {
    console.error("\n✗", e);
  }
  process.exit(1);
});
