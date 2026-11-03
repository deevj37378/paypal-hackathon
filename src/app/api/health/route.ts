import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getAccessToken } from "@/lib/paypal/client";

export async function GET() {
  const result: Record<string, string> = {};
  try {
    await db().execute(sql`select 1`);
    result.db = "ok";
  } catch (e) {
    result.db = `error: ${(e as Error).message}`;
  }
  try {
    await getAccessToken();
    result.paypal = "ok";
  } catch (e) {
    result.paypal = `error: ${(e as Error).message}`;
  }
  const ok = Object.values(result).every((v) => v === "ok");
  return Response.json(result, { status: ok ? 200 : 503 });
}
