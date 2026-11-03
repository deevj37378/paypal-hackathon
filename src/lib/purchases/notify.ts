import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { formatUsd } from "@/lib/money";
import { escapeHtml, telegramEnabled, tg } from "@/lib/telegram";

type Purchase = typeof schema.purchases.$inferSelect;

const what = (p: Purchase) => p.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(", ");
const link = (p: Purchase) => `${env().APP_URL}/purchases/${p.id}`;

/**
 * Owner notifications over Telegram. Never throws: a notification failure must not affect money flow.
 * - pending_approval → message with Approve / Decline buttons (message id saved so it can be edited later)
 * - captured / blocked / declined / failed → short note, or an in-place edit of the approval message
 */
export async function notifyPurchase(purchase: Purchase, agentName?: string): Promise<void> {
  try {
    if (!telegramEnabled()) return;
    const [user] = await db().select().from(schema.users).where(eq(schema.users.id, purchase.userId)).limit(1);
    const chatId = user?.telegramChatId;
    if (!chatId) return;

    const amount = formatUsd(purchase.totalCents);
    const who = escapeHtml(agentName ?? "Your agent");

    if (purchase.status === "pending_approval") {
      const text =
        `🟡 <b>Approve ${amount}?</b>\n${who} wants <b>${escapeHtml(what(purchase))}</b>.\n` +
        (purchase.reason ? `“${escapeHtml(purchase.reason)}”\n` : "") +
        `\nWhy you're asked: ${escapeHtml(purchase.decision.reasons.join(" "))}`;
      const msg = await tg<{ message_id: number }>("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: `✅ Approve ${amount}`, callback_data: `a:${purchase.id}` },
              { text: "✖️ Decline", callback_data: `d:${purchase.id}` },
            ],
            [{ text: "Open in Allowance", url: link(purchase) }],
          ],
        },
      });
      await db()
        .update(schema.purchases)
        .set({ telegramMessageId: String(msg.message_id) })
        .where(eq(schema.purchases.id, purchase.id));
      return;
    }

    const line = statusLine(purchase, amount);
    if (!line) return;

    // If this purchase had an approval message, edit it in place instead of sending a new one.
    const [fresh] = await db()
      .select({ messageId: schema.purchases.telegramMessageId })
      .from(schema.purchases)
      .where(eq(schema.purchases.id, purchase.id))
      .limit(1);
    if (fresh?.messageId) {
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: Number(fresh.messageId),
        text: `${line}\n<i>${escapeHtml(what(purchase))}</i>`,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "Open in Allowance", url: link(purchase) }]] },
      }).catch((e) => console.error("[telegram] edit failed", e));
      return;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text: `${line}\n<i>${escapeHtml(what(purchase))}</i>`,
      parse_mode: "HTML",
      disable_notification: purchase.status === "captured",
    });
  } catch (e) {
    console.error("[notify]", e);
  }
}

function statusLine(p: Purchase, amount: string) {
  switch (p.status) {
    case "captured":
      return `✅ <b>Paid ${amount}</b> with your PayPal.`;
    case "blocked":
      return `⛔️ <b>Blocked ${amount}</b>: ${escapeHtml(p.decision.reasons.join(" "))}`;
    case "declined":
      return `✖️ <b>Declined ${amount}</b>. Nothing was charged.`;
    case "expired":
      return `⌛️ <b>Expired ${amount}</b>. Nobody approved it in time.`;
    case "failed":
      return `⚠️ <b>Payment failed ${amount}</b>. Nothing was charged.`;
    default:
      return null;
  }
}
