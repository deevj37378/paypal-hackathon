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
import { formatWhen } from "@/lib/format";
import { getSessionUserId } from "@/lib/session";
import { AgentsPanel } from "./agents-panel";
import { AutoRefresh } from "./auto-refresh";
import { ApprovalButtons, RefundButton } from "./purchase-actions";
import { TelegramCard } from "./telegram-card";
import { GuidedDemo, type ScenarioState } from "./guided-demo";
import { DEMO_SCENARIOS, type DemoScenario } from "@/lib/demo";
import { PAYOUT_STATUS, PURCHASE_STATUS } from "@/lib/purchases/labels";
import { telegramEnabled } from "@/lib/telegram";
import { db, schema } from "@/db";
import { grantState, listGrants } from "@/lib/allowances";
import { grantScope, STATE } from "@/lib/allowance-format";
import { ApprovalHelp } from "@/components/approval-help";

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
  const [d, grants] = await Promise.all([getDashboard(userId), listGrants(userId)]);
  if (!d.user) redirect("/");
  const shownGrants = grants.filter((g) => grantState(g) === "active" || grantState(g) === "used").slice(0, 3);
  const merchantNames = Object.fromEntries((await db().select({ id: schema.merchants.id, name: schema.merchants.name }).from(schema.merchants)).map((m) => [m.id, m.name]));
  const pending = d.purchases.filter((p) => p.purchase.status === "pending_approval");
  const LATEST_BUILTIN = d.agents.find((a) => a.keyPrefix === "builtin")?.id;
  // Live state of each guided-demo step: the latest purchase the built-in agent made for that scenario.
  const builtinIds = new Set(d.agents.filter((a) => a.keyPrefix === "builtin").map((a) => a.id));
  const scenarioState = Object.fromEntries(
    (Object.keys(DEMO_SCENARIOS) as DemoScenario[]).map((key) => {
      const sc = DEMO_SCENARIOS[key];
      const hit = d.purchases.find(
        ({ purchase: p }) =>
          p.agentId !== null &&
          builtinIds.has(p.agentId) &&
          p.merchantId === sc.input.merchant_id &&
          p.items[0]?.productId === sc.input.items[0].product_id,
      )?.purchase;
      return [key, hit ? { purchaseId: hit.id, status: hit.status, payoutStatus: hit.payoutStatus, reason: hit.decision.reasons[0] ?? null, reasons: hit.decision.checks.filter((c) => c.status !== "pass").map((c) => c.detail) } : null];
    }),
  ) as Record<DemoScenario, ScenarioState | null>;

  return (
    <>
      <AutoRefresh />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">What your agents asked for, what your rules decided, and where the money went.</p>
        </div>
        {d.user.isDemo === 1 && d.user.expiresAt && (
          <p className="text-xs text-muted-foreground">
            Demo account · sandbox only · expires {formatWhen(d.user.expiresAt)}
          </p>
        )}
      </div>
      {!d.vault && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <p>Link PayPal so approved purchases can be paid. Until then, every request is blocked.</p>
          <Link href="/link-paypal" className={buttonVariants({ size: "sm" })}>
            Link PayPal
          </Link>
        </div>
      )}

      {pending.length > 0 && (
        <Card id="approvals" className="scroll-mt-20 border-amber-300">
          <CardHeader>
            <CardTitle>Waiting for your approval</CardTitle>
            <CardDescription className="space-y-1">
              <p>Your agent asked for these, but your rules say to check with you first.</p>
              <ApprovalHelp telegram={Boolean(d.user.telegramChatId)} place="here" />
            </CardDescription>
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

      <GuidedDemo isDemo={Boolean(d.user.isDemo)} telegram={Boolean(d.user.telegramChatId)} state={scenarioState} />
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

      {shownGrants.length > 0 && (
        <Card>
          <CardHeader>
            <CardDescription>One-time allowances</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {shownGrants.map((g) => {
                const st = grantState(g);
                return (
                  <li key={g.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-medium">{g.description}</span>{" "}
                      <span className="text-muted-foreground">
                        · {grantScope(g, merchantNames)} · {st === "active" ? `until ${formatWhen(g.expiresAt)}` : "used"}
                      </span>
                    </span>
                    <Badge className={STATE[st].className}>{STATE[st].label}</Badge>
                  </li>
                );
              })}
            </ul>
            <Link href="/rules#one-time" className="mt-3 inline-block text-sm underline underline-offset-2">
              Manage one-time allowances
            </Link>
          </CardContent>
        </Card>
      )}

      <PurchasesCard purchases={d.purchases} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <AgentsPanel
          mcpUrl={`${env().APP_URL}/api/mcp`}
          agents={d.agents.map((a) => ({
            id: a.id,
            name: a.name,
            keyLast4: a.keyLast4,
            status: a.status,
            lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
            builtIn: a.keyPrefix === "builtin",
            isLatestBuiltIn: a.id === LATEST_BUILTIN,
          }))}
        />

        <div id="telegram" className="scroll-mt-20">
          <TelegramCard connected={Boolean(d.user.telegramChatId)} username={d.user.telegramUsername} enabled={telegramEnabled()} />
        </div>
      </div>
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
    policy.velocity && `Ask after ${policy.velocity.maxPurchases} buys in ${policy.velocity.windowMinutes} min`,
    policy.duplicateWindowDays !== null && `Ask before re-buying within ${policy.duplicateWindowDays} days`,
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
        <Link href="/rules#one-time" className="mt-3 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
          + One-time allowance (e.g. a gift)
        </Link>
      </CardContent>
    </Card>
  );
}

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
          <>
            {/* Phones: stacked cards (a 5-column table doesn't fit 390px). */}
            <ul className="divide-y rounded-lg border sm:hidden">
              {purchases.map(({ purchase: p, agentName, merchantName }) => {
                const s = PURCHASE_STATUS[p.status] ?? { label: p.status, className: "" };
                return (
                  <li key={p.id} className="space-y-1.5 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/purchases/${p.id}`} className="min-w-0 font-medium hover:underline">
                        {p.items.map((i) => i.name).join(", ")}
                      </Link>
                      <span className="shrink-0 tabular-nums">{formatUsd(p.totalCents)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={s.className}>{s.label}</Badge>
                      {PAYOUT_STATUS[p.payoutStatus] && p.status !== "refunded" && (
                        <span className="text-xs text-muted-foreground">{PAYOUT_STATUS[p.payoutStatus]}</span>
                      )}
                    </div>
                    {(p.status === "blocked" || p.status === "failed") && (
                      <p className="text-xs text-muted-foreground">{p.failureReason ?? p.decision.reasons[0]}</p>
                    )}
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {agentName ?? "Agent"} · {merchantName} · {formatWhen(p.createdAt)}
                      </span>
                      {p.status === "captured" && <RefundButton purchaseId={p.id} amount={formatUsd(p.totalCents)} />}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden sm:block">
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
                const s = PURCHASE_STATUS[p.status] ?? { label: p.status, className: "" };
                return (
                  <TableRow key={p.id}>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatWhen(p.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-64">
                      <Link href={`/purchases/${p.id}`} className="block truncate font-medium hover:underline">
                        {p.items.map((i) => i.name).join(", ")}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {merchantName}
                        {(p.status === "blocked" || p.status === "failed") && ` · ${p.failureReason ?? p.decision.reasons[0] ?? ""}`}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">{agentName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(p.totalCents)}</TableCell>
                    <TableCell>
                      <Badge className={s.className}>{s.label}</Badge>
                      {PAYOUT_STATUS[p.payoutStatus] && p.status !== "refunded" && (
                        <p className="mt-1 text-xs text-muted-foreground">{PAYOUT_STATUS[p.payoutStatus]}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{p.status === "captured" && <RefundButton purchaseId={p.id} amount={formatUsd(p.totalCents)} />}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
            </div>
          </>
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
