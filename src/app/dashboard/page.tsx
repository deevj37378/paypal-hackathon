import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDashboard, type Dashboard } from "@/lib/dashboard";
import { formatUsd } from "@/lib/money";
import type { PolicyRules } from "@/lib/policy/schema";
import { env } from "@/lib/env";
import { getSessionUserId } from "@/lib/session";
import { AgentsPanel } from "./agents-panel";
import { AutoRefresh } from "./auto-refresh";
import { ApprovalButtons, RefundButton } from "./purchase-actions";

export const metadata = { title: "Dashboard · Allowance" };

export default function Page() {
  return (
    <AppShell active="dashboard">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </AppShell>
  );
}

async function DashboardContent() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const d = await getDashboard(userId);
  if (!d.user) redirect("/");
  const pending = d.purchases.filter((p) => p.purchase.status === "pending_approval");

  return (
    <>
      <AutoRefresh />
      {!d.vault && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p>Link PayPal so approved purchases can be paid. Until then, every request is blocked.</p>
          <Link href="/link-paypal" className={buttonVariants({ size: "sm" })}>
            Link PayPal
          </Link>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SpendCard spent={d.spent} policy={d.policy?.rules ?? null} />
        <RulesCard policy={d.policy?.rules ?? null} />
        <Card>
          <CardHeader>
            <CardDescription>Paying with</CardDescription>
            <CardTitle className="truncate text-base">{d.vault?.payerEmail ?? "Not linked"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {d.vault ? "PayPal (saved with your consent)" : "Link PayPal to start."}{" "}
            <Link href="/link-paypal" className="underline">
              {d.vault ? "Change" : "Link"}
            </Link>
          </CardContent>
        </Card>
      </div>

      {pending.length > 0 && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle>Waiting for your approval</CardTitle>
            <CardDescription>Your agent asked for these, but your rules say to check with you first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pending.map(({ purchase: p, agentName, merchantName }) => (
              <div key={p.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1 text-sm">
                  <p className="font-medium">
                    {formatUsd(p.totalCents)} · {p.items.map((i) => i.name).join(", ")}
                  </p>
                  <p className="text-muted-foreground">
                    {agentName ?? "Agent"} at {merchantName} · {p.decision.reasons.join(" ")}
                  </p>
                </div>
                <ApprovalButtons purchaseId={p.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AgentsPanel
        mcpUrl={`${env().APP_URL}/api/mcp`}
        agents={d.agents.map((a) => ({
          id: a.id,
          name: a.name,
          keyLast4: a.keyLast4,
          status: a.status,
          lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
          builtIn: a.keyPrefix === "builtin",
        }))}
      />

      <PurchasesCard purchases={d.purchases} />
    </>
  );
}

function SpendCard({ spent, policy }: { spent: number; policy: PolicyRules | null }) {
  const limit = policy?.monthlyLimitCents ?? 0;
  const pct = limit ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
  return (
    <Card>
      <CardHeader>
        <CardDescription>Spent this month</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {formatUsd(spent)} <span className="text-base font-normal text-muted-foreground">of {formatUsd(limit)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className="h-2 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={spent}
          aria-label="Monthly allowance used"
        >
          <div className={`h-full rounded-full ${pct >= 90 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{formatUsd(Math.max(0, limit - spent))} left</p>
      </CardContent>
    </Card>
  );
}

function RulesCard({ policy }: { policy: PolicyRules | null }) {
  if (!policy) {
    return (
      <Card>
        <CardHeader>
          <CardDescription>Your rules</CardDescription>
          <CardTitle className="text-base">No active rules</CardTitle>
        </CardHeader>
      </Card>
    );
  }
  const rules = [
    `${formatUsd(policy.monthlyLimitCents)} per month`,
    policy.perOrderLimitCents !== null && `Max ${formatUsd(policy.perOrderLimitCents)} per order`,
    policy.approvalThresholdCents !== null && `Ask me over ${formatUsd(policy.approvalThresholdCents)}`,
    policy.allowedCategories.length > 0 && `Only ${policy.allowedCategories.join(", ")}`,
    policy.requireApprovalForNewMerchants && "Ask before new merchants",
  ].filter(Boolean) as string[];
  return (
    <Card>
      <CardHeader>
        <CardDescription>Your rules</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {rules.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="text-muted-foreground">•</span>
              {r}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const STATUS: Record<string, { label: string; className: string }> = {
  captured: { label: "Paid", className: "bg-emerald-100 text-emerald-800" },
  processing: { label: "Processing", className: "bg-sky-100 text-sky-800" },
  pending_approval: { label: "Needs approval", className: "bg-amber-100 text-amber-800" },
  blocked: { label: "Blocked", className: "bg-red-100 text-red-800" },
  declined: { label: "Declined", className: "bg-zinc-100 text-zinc-700" },
  expired: { label: "Expired", className: "bg-zinc-100 text-zinc-700" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800" },
  refunded: { label: "Refunded", className: "bg-violet-100 text-violet-800" },
};

const PAYOUT: Record<string, string> = {
  none: "",
  scheduled: "Held for refunds",
  processing: "Paying store…",
  sent: "Paying store…",
  paid: "Store paid",
  cancelled: "Payout cancelled",
  failed: "Payout failed",
};

function PurchasesCard({ purchases }: { purchases: Dashboard["purchases"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchases</CardTitle>
        <CardDescription>Everything your agents tried to buy, and what your rules decided.</CardDescription>
      </CardHeader>
      <CardContent>
        {purchases.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No purchases yet. Create an agent key above and let your agent shop.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map(({ purchase: p, agentName, merchantName }) => {
                const s = STATUS[p.status] ?? { label: p.status, className: "" };
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {p.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC
                    </TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate">{p.items.map((i) => i.name).join(", ")}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {merchantName}
                        {(p.status === "blocked" || p.status === "failed") && ` · ${p.failureReason ?? p.decision.reasons[0] ?? ""}`}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{agentName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(p.totalCents)}</TableCell>
                    <TableCell>
                      <Badge className={s.className}>{s.label}</Badge>
                      {PAYOUT[p.payoutStatus] && p.status !== "refunded" && (
                        <p className="mt-1 text-xs text-muted-foreground">{PAYOUT[p.payoutStatus]}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{p.status === "captured" && <RefundButton purchaseId={p.id} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
