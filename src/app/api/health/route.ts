import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";
import { getAccessToken } from "@/lib/paypal/client";

/** Liveness for DB + PayPal. Error details are logged server-side and only shown in development. */
export async function GET() {
  await connection();
  const isProd = process.env.NODE_ENV === "production";
  const result: Record<string, string> = {};
  const probe = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      result[name] = "ok";
    } catch (e) {
      console.error(`[health] ${name}:`, e);
      result[name] = isProd ? "error" : `error: ${(e as Error).message}`;
    }
  };
  await Promise.all([probe("db", () => db().execute(sql`select 1`)), probe("paypal", getAccessToken)]);
  const ok = Object.values(result).every((v) => v === "ok");
  return Response.json({ ok, ...result }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
