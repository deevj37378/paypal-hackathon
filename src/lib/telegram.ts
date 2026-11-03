import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";

/** Thin Telegram Bot API client (free). https://core.telegram.org/bots/api */

export const telegramEnabled = () => Boolean(env().TELEGRAM_BOT_TOKEN);

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
  return data.result as T;
}

let botUsername: string | undefined;
export async function getBotUsername() {
  botUsername ??= (await tg<{ username: string }>("getMe", {})).username;
  return botUsername;
}

/** Constant-time check of Telegram's X-Telegram-Bot-Api-Secret-Token header. */
export function verifyTelegramSecret(header: string | null) {
  const secret = env().TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One-time deep link: t.me/<bot>?start=<code>, valid 15 minutes. */
export async function createLinkCode(userId: string) {
  const code = randomBytes(18).toString("base64url"); // 24 chars, allowed in start params
  await db().insert(schema.telegramLinkCodes).values({ code, userId, expiresAt: new Date(Date.now() + 15 * 60_000) });
  const bot = await getBotUsername();
  // t.me is blocked on some networks/ISPs, so also offer the tg:// app link and a manual "/start <code>".
  return { code, bot, url: `https://t.me/${bot}?start=${code}`, appUrl: `tg://resolve?domain=${bot}&start=${code}` };
}

/** Consume a /start code and attach the chat to the user. Returns the user id or null. */
export async function consumeLinkCode(code: string, chatId: string, username?: string) {
  const [row] = await db()
    .update(schema.telegramLinkCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(schema.telegramLinkCodes.code, code),
        isNull(schema.telegramLinkCodes.usedAt),
        gt(schema.telegramLinkCodes.expiresAt, new Date()),
      ),
    )
    .returning({ userId: schema.telegramLinkCodes.userId });
  if (!row) return null;
  await db()
    .update(schema.users)
    .set({ telegramChatId: chatId, telegramUsername: username ?? null })
    .where(eq(schema.users.id, row.userId));
  return row.userId;
}

export async function userByChatId(chatId: string) {
  const [u] = await db().select().from(schema.users).where(eq(schema.users.telegramChatId, chatId)).limit(1);
  return u ?? null;
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
