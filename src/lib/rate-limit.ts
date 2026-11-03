import { sql } from "drizzle-orm";
import { db, schema } from "@/db";

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterSeconds: number,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Fixed-window rate limit stored in Postgres (free; no Redis). One upsert per call.
 * Throws RateLimitError when `limit` is exceeded within `windowSeconds`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, what = "requests") {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await db()
    .insert(schema.rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [schema.rateLimits.key, schema.rateLimits.windowStart],
      set: { count: sql`${schema.rateLimits.count} + 1` },
    })
    .returning({ count: schema.rateLimits.count });
  if (row.count > limit) {
    const retry = Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now) / 1000);
    throw new RateLimitError(`Too many ${what}. Try again in ${retry}s.`, retry);
  }
  return { remaining: limit - row.count };
}

/** Housekeeping (cron): drop windows older than a day. */
export async function pruneRateLimits() {
  await db().execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
}

/** Best-effort client IP for anonymous limits (Vercel sets x-forwarded-for). */
export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}
