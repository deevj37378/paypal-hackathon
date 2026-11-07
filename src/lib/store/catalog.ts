import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";

export const STORE_MERCHANTS = ["demo-store", "gadget-hub", "deals-hub"];

/** Public catalog of the demo merchants. */
export async function getCatalog() {
  return db()
    .select({ p: schema.products, merchantName: schema.merchants.name })
    .from(schema.products)
    .innerJoin(schema.merchants, eq(schema.products.merchantId, schema.merchants.id))
    .where(inArray(schema.products.merchantId, STORE_MERCHANTS))
    .orderBy(asc(schema.products.merchantId), asc(schema.products.category), asc(schema.products.priceCents));
}
