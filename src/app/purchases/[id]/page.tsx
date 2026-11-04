import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { getSessionUserId } from "@/lib/session";
import { ApprovalButtons, RefundButton } from "@/app/dashboard/purchase-actions";
import { PURCHASE_STATUS, PAYOUT_STATUS } from "@/lib/purchases/labels";
import { explainDecision } from "@/lib/ai/explain";

export const metadata = { title: "Purchase · Allowance" };

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <AppShell active="dashboard">
      <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
        ← Dashboard
      </Link>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl border bg-muted/40" />}>
        <PurchaseDetail params={params} />
      </Suspense>
    </AppShell>
  );
}

async function PurchaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const { id } = await params;
  const [row] = await db()
    .select({ p: schema.purchases, agentName: schema.agents.name, merchantName: schema.merchants.name })
    .from(schema.purchases)
    .leftJoin(schema.agents, eq(schema.purchases.agentId, schema.agents.id))
    .leftJoin(schema.merchants, eq(schema.purchases.merchantId, schema.merchants.id))
    .where(and(eq(schema.purchases.id, id), eq(schema.purchases.userId, userId)))
    .limit(1);
  if (!row) notFound();
  const { p, agentName, merchantName } = row;
  const events = await db().select().from(schema.purchaseEvents).where(eq(schema.purchaseEvents.purchaseId, p.id)).orderBy(asc(schema.purchaseEvents.createdAt));
  const s = PURCHASE_STATUS[p.status];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardDescription>
              {agentName ?? "Agent"} at {merchantName}
            </CardDescription>
            <CardTitle className="flex flex-wrap items-center gap-3 text-3xl tabular-nums">
              {formatUsd(p.totalCents)}
              <Badge className={s.className}>{s.label}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <ul className="divide-y rounded-lg border">
              {p.items.map((i) => (
                <li key={i.productId} className="flex justify-between gap-3 p-3">
                  <span>
                    {i.quantity > 1 && `${i.quantity} × `}
                    {i.name} <span className="text-muted-foreground">· {i.category}</span>
                  </span>
                  <span className="tabular-nums">{formatUsd(i.unitPriceCents * i.quantity)}</span>
                </li>
              ))}
            </ul>
            {p.decision.outcome !== "approved" && (
              <Suspense fallback={<p className="h-10 animate-pulse rounded-lg bg-muted/50" aria-label="Loading explanation" />}>
                <Explanation purchase={p} />
              </Suspense>
            )}
            {p.reason && (
              <p>
                <span className="text-muted-foreground">Agent&apos;s reason:</span> “{p.reason}”
              </p>
            )}
            {p.status === "pending_approval" && (
              <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-amber-900">{p.decision.reasons.join(" ")}</p>
                <ApprovalButtons purchaseId={p.id} />
              </div>
            )}
            {p.status === "captured" && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">{PAYOUT_STATUS[p.payoutStatus] || "Paid"}</span>
                <RefundButton purchaseId={p.id} amount={formatUsd(p.totalCents)} />
              </div>
            )}
            {p.failureReason && p.status === "failed" && <p className="text-destructive">{p.failureReason}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l pl-5">
              {events.map((e) => (
                <li key={e.id} className="relative">
                  <span aria-hidden className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-primary" />
                  <p className="text-sm">{e.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.createdAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" })} UTC
                  </p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Rule check</CardTitle>
          <CardDescription>Decided by Allowance&apos;s deterministic checker, not by AI.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {p.decision.checks.map((c) => (
              <li key={c.id} className="flex gap-2">
                <span aria-hidden className={c.status === "pass" ? "text-emerald-600" : c.status === "hold" ? "text-amber-600" : "text-red-600"}>
                  {c.status === "pass" ? "✓" : c.status === "hold" ? "●" : "✕"}
                </span>
                <span>
                  <span className="font-medium">{c.label}</span>
                  <span className="sr-only"> ({c.status})</span>
                  <br />
                  <span className="text-muted-foreground">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

async function Explanation({ purchase }: { purchase: Parameters<typeof explainDecision>[0] }) {
  const { text, source } = await explainDecision(purchase);
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {source === "ai" ? "In plain English (AI)" : "Why"}
      </p>
      <p className="mt-1">{text}</p>
      {source === "ai" && <p className="mt-1 text-xs text-muted-foreground">Explanation only. The decision itself was made by the rule checker.</p>}
    </div>
  );
}
