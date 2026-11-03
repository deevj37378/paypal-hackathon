import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/rate-limit";

/** Per-user hourly limit + global daily cap for every LLM call. Throws RateLimitError. */
export async function aiQuota(scope: string, perHour: number) {
  await rateLimit(`ai:${scope}`, perHour, 3600, "AI requests");
  await rateLimit("ai:global", env().AI_DAILY_LIMIT, 86_400, "AI requests today (shared demo quota)");
}

export const hashKey = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex");

export async function cacheGet<T>(key: string): Promise<T | null> {
  const [row] = await db().select().from(schema.aiCache).where(eq(schema.aiCache.key, key)).limit(1);
  return (row?.value as T) ?? null;
}

export async function cacheSet(key: string, value: unknown) {
  await db().insert(schema.aiCache).values({ key, value }).onConflictDoUpdate({ target: schema.aiCache.key, set: { value } });
}
