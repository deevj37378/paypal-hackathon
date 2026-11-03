import { Pool } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { env } from "@/lib/env";
import * as schema from "./schema";

/** Anything that can run Drizzle queries: the HTTP `db()` or a transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbExecutor = PgDatabase<any, typeof schema>;

/**
 * Run `fn` in a Postgres transaction holding a per-user advisory lock, so
 * "read spend → check rules → reserve purchase" is atomic per user. Parallel agent
 * calls for the same user queue behind each other; other users are unaffected.
 * Uses the Neon WebSocket Pool (HTTP can't do interactive transactions); the pool
 * lives only for this call, as Neon requires in serverless environments.
 */
export async function withUserLock<T>(userId: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: env().DATABASE_URL });
  pool.on("error", (e: Error) => console.error("[db pool]", e));
  try {
    const tdb = drizzle({ client: pool, schema });
    return await tdb.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"allowance:user:" + userId}, 0))`);
      return fn(tx as unknown as DbExecutor);
    });
  } finally {
    await pool.end();
  }
}
