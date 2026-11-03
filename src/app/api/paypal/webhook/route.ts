import { handleWebhookEvent, verifyWebhook } from "@/lib/paypal/webhooks";

/**
 * PayPal webhook receiver. Signature verified via PayPal's API before anything is trusted.
 * Unverified → 401 (PayPal retries; forged requests are ignored). Handler errors → 500 so PayPal retries.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let verified = false;
  try {
    verified = await verifyWebhook(req.headers, raw);
  } catch (e) {
    console.error("[paypal webhook] verify error", e);
    return new Response("verification unavailable", { status: 503 });
  }
  if (!verified) {
    console.warn("[paypal webhook] signature verification failed", req.headers.get("paypal-transmission-id"));
    return new Response("invalid signature", { status: 401 });
  }
  try {
    const event = JSON.parse(raw);
    const outcome = await handleWebhookEvent(event);
    console.log(`[paypal webhook] ${event.event_type} ${event.id} → ${outcome}`);
    return Response.json({ ok: true, outcome });
  } catch (e) {
    console.error("[paypal webhook] handler error", e);
    return new Response("error", { status: 500 });
  }
}
