/**
 * Mirror the demo store's products into the PayPal Catalog Products API (sandbox) and store the
 * PayPal product ids. Idempotent: our product id is used as PayPal's product id.
 *   npm run catalog:sync            (dev DB)     npm run catalog:sync:prod   (live DB)
 * Docs: https://developer.paypal.com/api/catalog-products/v1/
 */
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { PayPalError, paypalFetch } from "@/lib/paypal/client";
import { STORE_MERCHANTS } from "@/lib/store/catalog";

const CATEGORY: Record<string, string> = {
  coffee: "COFFEE_AND_TEA",
  books: "BOOKS",
  kitchen: "HOUSEWARES",
  electronics: "HOME_AUDIO",
};

(async () => {
  const products = await db().select().from(schema.products).where(inArray(schema.products.merchantId, STORE_MERCHANTS));
  for (const p of products) {
    const id = `ALW-${p.id}`.slice(0, 50);
    let remote: { id: string } | null = null;
    try {
      remote = await paypalFetch<{ id: string }>(`/v1/catalogs/products/${id}`);
    } catch (e) {
      if (!(e instanceof PayPalError && e.status === 404)) throw e;
    }
    if (!remote) {
      remote = await paypalFetch<{ id: string }>("/v1/catalogs/products", {
        requestId: `catalog-${id}`,
        body: {
          id,
          name: p.name.slice(0, 127),
          description: (p.description ?? p.name).slice(0, 256),
          type: "PHYSICAL",
          ...(CATEGORY[p.category] ? { category: CATEGORY[p.category] } : {}),
        },
      });
      console.log(`created ${remote.id}`);
    } else console.log(`exists  ${remote.id}`);
    await db().update(schema.products).set({ paypalProductId: remote.id }).where(eq(schema.products.id, p.id));
  }
  console.log(`synced ${products.length} products`);
  process.exit(0);
})().catch((e) => {
  console.error(e instanceof PayPalError ? `${e.message} debug_id=${e.debugId}` : e);
  process.exit(1);
});
