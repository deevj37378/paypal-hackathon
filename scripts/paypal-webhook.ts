/**
 * Manage the sandbox PayPal webhook for the live app.
 *   npx tsx --env-file=.env.local scripts/paypal-webhook.ts list
 *   npx tsx --env-file=.env.local scripts/paypal-webhook.ts create https://<app>/api/paypal/webhook
 */
import { paypalFetch } from "@/lib/paypal/client";
import { WEBHOOK_EVENTS } from "@/lib/paypal/webhooks";

type Hook = { id: string; url: string; event_types: { name: string }[] };

(async () => {
  const [cmd, url] = process.argv.slice(2);
  const { webhooks } = await paypalFetch<{ webhooks: Hook[] }>("/v1/notifications/webhooks");
  if (cmd === "list") {
    for (const w of webhooks) console.log(w.id, w.url, w.event_types.map((e) => e.name).join(","));
    if (!webhooks.length) console.log("(no webhooks)");
  } else if (cmd === "create" && url) {
    const existing = webhooks.find((w) => w.url === url);
    if (existing) {
      console.log(`exists: ${existing.id}`);
    } else {
      const hook = await paypalFetch<Hook>("/v1/notifications/webhooks", {
        body: { url, event_types: WEBHOOK_EVENTS.map((name) => ({ name })) },
      });
      console.log(`created: ${hook.id}`);
    }
  } else {
    console.log("usage: list | create <url>");
  }
  process.exit(0);
})().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
