import { connection } from "next/server";
import { env } from "@/lib/env";
import { getCatalog } from "@/lib/store/catalog";

/** Agent-readable product feed (public). Agents buy through Allowance's MCP request_purchase. */
export async function GET() {
  await connection();
  const rows = await getCatalog();
  return Response.json(
    {
      store: "Bean & Page (Allowance demo store)",
      currency: "USD",
      how_to_buy: {
        mcp_server: `${env().APP_URL}/api/mcp`,
        tool: "request_purchase",
        note: "Prices and categories are enforced server-side; pass product_id and merchant_id exactly as listed.",
      },
      products: rows.map(({ p, merchantName }) => ({
        product_id: p.id,
        merchant_id: p.merchantId,
        merchant_name: merchantName,
        name: p.name,
        description: p.description,
        category: p.category,
        price: (p.priceCents / 100).toFixed(2),
        currency: "USD",
        paypal_catalog_product_id: p.paypalProductId,
      })),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300", "Access-Control-Allow-Origin": "*" } },
  );
}
