/**
 * Register the Telegram bot webhook (secret header = TELEGRAM_WEBHOOK_SECRET).
 *   npx tsx --env-file=.env.local scripts/telegram-webhook.ts https://<app>/api/telegram/webhook
 */
import { tg } from "@/lib/telegram";

(async () => {
  const url = process.argv[2];
  if (!url) throw new Error("usage: telegram-webhook.ts <url>");
  await tg("setWebhook", {
    url,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  const info = await tg<{ url: string; pending_update_count: number; last_error_message?: string }>("getWebhookInfo", {});
  const me = await tg<{ username: string }>("getMe", {});
  console.log(`bot @${me.username} → ${info.url} (pending ${info.pending_update_count})${info.last_error_message ? ` last error: ${info.last_error_message}` : ""}`);
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
