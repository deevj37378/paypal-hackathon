import { and, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteHeader } from "@/components/app/site-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyToken } from "@/lib/mandates/mandate";
import { issueReceipt } from "@/lib/mandates/receipts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { PAYOUT_STATUS, PURCHASE_STATUS } from "@/lib/purchases/labels";

export const metadata = { title: "Merchant view · Bean & Page" };

const MERCHANT = "demo-store";

export default function MerchantPage() {
  return (
    <>
      <SiteHeader>
        <nav aria-label="Store" className="flex items-center gap-4 text-sm">
          <Link href="/store" className="text-muted-foreground hover:text-foreground">
            Storefront
          </Link>
          <Link href="/store/analytics" className="font-medium text-primary hover:underline">
            Analytics dashboard
          </Link>
        </nav>
      </SiteHeader>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-10 sm:px-6">
        <div className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Merchant view · Bean &amp; Page</p>
          <h1 className="text-2xl font-semibold tracking-tight">Sales made by AI agents</h1>
          <p className="text-sm text-muted-foreground">
            Every order here was placed by an agent, approved by its owner&apos;s rules, paid by the owner&apos;s PayPal, and paid out to
            this store with PayPal Payouts after a short refund window.{" "}
            <Link href="/store/analytics" className="underline underline-offset-4">
              Explore it in the analytics dashboard →
            </Link>
          </p>
        </div>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-xl border bg-muted/40" />}>
          <MerchantContent />
        </Suspense>
      </main>
    </>
  );
}

async function MerchantContent() {
  await connection();
  const p = schema.purchases;
  const [stats] = await db()
    .select({
      orders: sql<number>`count(*) filter (where ${p.status} in ('captured','refunded'))::int`,
      gross: sql<number>`coalesce(sum(${p.totalCents}) filter (where ${p.status} in ('captured','refunded')), 0)::int`,
      paidOut: sql<number>`coalesce(sum(${p.payoutCents}) filter (where ${p.payoutStatus} = 'paid'), 0)::int`,
      pending: sql<number>`coalesce(sum(${p.totalCents}) filter (where ${p.status} = 'captured' and ${p.payoutStatus} in ('scheduled','processing','sent')), 0)::int`,
      refunds: sql<number>`coalesce(sum(${p.totalCents}) filter (where ${p.status} = 'refunded'), 0)::int`,
      refundCount: sql<number>`count(*) filter (where ${p.status} = 'refunded')::int`,
      blocked: sql<number>`count(*) filter (where ${p.status} = 'blocked')::int`,
    })
    .from(p)
    .where(eq(p.merchantId, MERCHANT));
  const [merchant] = await db().select().from(schema.merchants).where(eq(schema.merchants.id, MERCHANT)).limit(1);
  const recent = await db()
    .select()
    .from(p)
    .where(and(eq(p.merchantId, MERCHANT), inArray(p.status, ["captured", "refunded", "processing"])))
    .orderBy(desc(p.createdAt))
    .limit(20);

  // The store verifies each order's AP2-style signed receipt before treating it as fulfilled:
  // signature against Allowance's JWKS, and the receipt must describe exactly this order.
  const verified = new Map(
    await Promise.all(
      recent.map(async (r) => {
        // Orders captured before receipts existed get theirs issued now (same signing path).
        const jws = r.receiptJws ?? (r.status === "captured" ? await issueReceipt(r.id) : null);
        if (!jws) return [r.id, false] as const;
        const v = await verifyToken(jws);
        const a = v.valid ? (v.payload.allowance as { purchase_id?: string; total?: { value?: string } } | undefined) : undefined;
        return [r.id, Boolean(a && a.purchase_id === r.id && a.total?.value === (r.totalCents / 100).toFixed(2))] as const;
      }),
    ),
  );

  const tiles = [
    { label: "Agent orders", value: String(stats.orders), note: `${formatUsd(stats.gross)} gross` },
    { label: "Paid out to you", value: formatUsd(stats.paidOut), note: "via PayPal Payouts" },
    { label: "In the refund window", value: formatUsd(stats.pending), note: "paid out when it closes" },
    { label: "Refunded", value: formatUsd(stats.refunds), note: `${stats.refundCount} order${stats.refundCount === 1 ? "" : "s"}` },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader>
              <CardDescription>{t.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{t.value}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">{t.note}</CardContent>
          </Card>
        ))}
      </div>
      {(merchant?.clawbackCents ?? 0) > 0 && (
        <p className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          {formatUsd(merchant!.clawbackCents)} from refunds after payout will be deducted from upcoming payouts.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Agents also tried {stats.blocked} order{stats.blocked === 1 ? "" : "s"} that their owners&apos; rules blocked. Those never
        reached your store.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>Recent agent orders</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No agent orders yet. <Link href="/" className="underline">Try the demo</Link> to place one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When (UTC)</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payout</TableHead>
                  <TableHead>Mandate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {r.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })}
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{r.items.map((i) => i.name).join(", ")}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.totalCents)}</TableCell>
                    <TableCell>
                      <Badge className={PURCHASE_STATUS[r.status]?.className}>{PURCHASE_STATUS[r.status]?.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{PAYOUT_STATUS[r.payoutStatus] || "—"}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {verified.get(r.id) ? (
                        <span className="font-medium text-emerald-700" title={`Signed receipt ${r.receiptId} verified against /.well-known/jwks.json`}>
                          ✓ Mandate verified · fulfilled
                        </span>
                      ) : r.status === "captured" ? (
                        <span className="text-amber-800" title="No valid signed receipt, so the store doesn't fulfil it yet">
                          Not verified · on hold
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
