import { z } from "zod";
import { formatUsd } from "@/lib/money";
import { decidePurchase, PurchaseInputError } from "@/lib/purchases/service";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db";
import { notifyPurchase } from "@/lib/purchases/notify";
import { consumeLinkCode, escapeHtml, purchaseOwnerForChat, tg, verifyTelegramSecret } from "@/lib/telegram";

/**
 * Telegram Bot webhook. Verified by the secret_token header we registered with setWebhook.
 * Always answers 200 for handled/ignored updates so Telegram doesn't retry them forever.
 */
const Update = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: z.object({ id: z.number() }),
      from: z.object({ username: z.string().optional() }).optional(),
      text: z.string().optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      message: z.object({ chat: z.object({ id: z.number() }), message_id: z.number() }).optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return new Response("forbidden", { status: 403 });
  }
  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("ok");
  const { message, callback_query: cb } = parsed.data;

  try {
    if (message?.text?.startsWith("/start")) {
      const chatId = String(message.chat.id);
      const code = message.text.split(/\s+/)[1];
      const userId = code ? await consumeLinkCode(code, chatId, message.from?.username) : null;
      await tg("sendMessage", {
        chat_id: chatId,
        parse_mode: "HTML",
        text: userId
          ? "✅ <b>Connected to Allowance.</b>\nWhen an agent wants to buy something your rules hold for approval, you'll get Approve / Decline buttons here. Anything already waiting follows below."
          : "👋 This is the Allowance approvals bot.\nTo connect, open your Allowance dashboard and tap <b>Connect Telegram</b>. (Links expire after 15 minutes.)",
      });
      if (userId) await sendWaitingApprovals(userId);
    } else if (cb?.data && cb.message) {
      await handleDecision(cb.id, String(cb.message.chat.id), cb.data);
    }
  } catch (e) {
    console.error("[telegram webhook]", e);
  }
  return new Response("ok");
}

async function handleDecision(callbackId: string, chatId: string, data: string) {
  const m = data.match(/^([ad]):(pur_[a-z0-9]{8,40})$/);
  const user = m ? await purchaseOwnerForChat(chatId, m[2]) : null;
  if (!m || !user) {
    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: "This chat isn't connected to that account.", show_alert: true });
    return;
  }
  const approve = m[1] === "a";
  try {
    const p = await decidePurchase({ userId: user.id, purchaseId: m[2], approve, via: "telegram" });
    const amount = formatUsd(p.totalCents);
    const text =
      p.status === "captured"
        ? `Approved. Paid ${amount}.`
        : p.status === "declined"
          ? "Declined. Nothing was charged."
          : p.status === "blocked"
            ? `Still blocked: ${p.decision.reasons.join(" ")}`
            : p.status === "expired"
              ? "That request already expired."
              : p.status === "failed"
                ? "Payment failed. Nothing was charged."
                : `Already ${p.status.replace("_", " ")}.`;
    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190) });
  } catch (e) {
    const msg = e instanceof PurchaseInputError ? e.message : "Something went wrong. Try the dashboard.";
    await tg("answerCallbackQuery", { callback_query_id: callbackId, text: escapeHtml(msg).slice(0, 190), show_alert: true });
  }
}

/** Purchases held before Telegram was connected still deserve buttons: send the backlog on connect. */
async function sendWaitingApprovals(userId: string) {
  const waiting = await db()
    .select({ p: schema.purchases, agentName: schema.agents.name })
    .from(schema.purchases)
    .leftJoin(schema.agents, eq(schema.purchases.agentId, schema.agents.id))
    .where(
      and(
        eq(schema.purchases.userId, userId),
        eq(schema.purchases.status, "pending_approval"),
        gt(schema.purchases.approvalExpiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.purchases.createdAt))
    .limit(10);
  for (const { p, agentName } of waiting.reverse()) await notifyPurchase(p, agentName ?? undefined);
}
