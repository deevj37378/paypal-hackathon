import { connection } from "next/server";
import { jwks } from "@/lib/mandates/keys";

/** Public keys that verify Allowance's AP2-style mandates and purchase receipts. */
export async function GET() {
  await connection(); // read the key at request time, never baked in at build
  return Response.json(await jwks(), { headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });
}
