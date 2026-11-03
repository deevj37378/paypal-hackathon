/**
 * Seeds the demo merchants and products (idempotent).  npm run db:seed
 * Products move into the PayPal Catalog API in M6; ids here stay stable.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";

const merchants = [
  { id: "demo-store", name: "Bean & Page", payoutEmail: env().STORE_PAYPAL_EMAIL },
  // A second store the default rules treat as "new" (needs approval the first time).
  { id: "gadget-hub", name: "Gadget Hub", payoutEmail: env().STORE_PAYPAL_EMAIL },
];

const products = [
  { id: "coffee-house-blend", merchantId: "demo-store", name: "House Blend Coffee Beans (12oz)", category: "coffee", priceCents: 1800, description: "Medium roast, chocolatey and smooth." },
  { id: "coffee-ethiopia", merchantId: "demo-store", name: "Ethiopia Yirgacheffe (12oz)", category: "coffee", priceCents: 2200, description: "Light roast, floral and bright." },
  { id: "coffee-decaf", merchantId: "demo-store", name: "Swiss Water Decaf (12oz)", category: "coffee", priceCents: 1600, description: "All the taste, none of the jitters." },
  { id: "book-pragmatic", merchantId: "demo-store", name: "The Pragmatic Programmer", category: "books", priceCents: 3200, description: "20th anniversary edition, hardcover." },
  { id: "book-atomic-habits", merchantId: "demo-store", name: "Atomic Habits", category: "books", priceCents: 1400, description: "Paperback." },
  { id: "book-dune", merchantId: "demo-store", name: "Dune", category: "books", priceCents: 1200, description: "Paperback." },
  { id: "book-designing-data", merchantId: "demo-store", name: "Designing Data-Intensive Applications", category: "books", priceCents: 4800, description: "Hardcover, over the per-order limit." },
  { id: "mug-ceramic", merchantId: "demo-store", name: "Ceramic Mug", category: "kitchen", priceCents: 1500, description: "Not coffee: shows a category block." },
  { id: "headphones-wireless", merchantId: "gadget-hub", name: "Wireless Headphones", category: "electronics", priceCents: 7900, description: "Noise cancelling." },
  { id: "coffee-cold-brew-kit", merchantId: "gadget-hub", name: "Cold Brew Coffee Kit", category: "coffee", priceCents: 2400, description: "Coffee, but from a merchant you haven't used." },
];

async function main() {
  for (const m of merchants) {
    await db()
      .insert(schema.merchants)
      .values(m)
      .onConflictDoUpdate({ target: schema.merchants.id, set: { name: m.name, payoutEmail: m.payoutEmail } });
  }
  for (const p of products) {
    await db()
      .insert(schema.products)
      .values(p)
      .onConflictDoUpdate({
        target: schema.products.id,
        set: { name: p.name, category: p.category, priceCents: p.priceCents, description: p.description, merchantId: p.merchantId },
      });
  }
  const [{ n }] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.products);
  console.log(`Seeded ${merchants.length} merchants, ${n} products.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
