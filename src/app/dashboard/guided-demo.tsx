"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_SCENARIOS, type DemoScenario } from "@/lib/demo";
import { PAYOUT_STATUS, PURCHASE_STATUS } from "@/lib/purchases/labels";

export type ScenarioState = { purchaseId: string; status: string; payoutStatus: string; reason: string | null };

/**
 * Guided demo. Each card shows the LIVE status of the latest purchase for that scenario (server data,
 * refreshed with the dashboard), so approvals, refunds and declines are reflected immediately.
 */
export function GuidedDemo({ isDemo, telegram, state }: { isDemo: boolean; telegram: boolean; state: Record<DemoScenario, ScenarioState | null> }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Partial<Record<DemoScenario, string>>>({});
  const [running, setRunning] = useState<DemoScenario | null>(null);
  const [, start] = useTransition();

  const run = (s: DemoScenario) =>
    start(async () => {
      setRunning(s);
      setErrors((e) => ({ ...e, [s]: undefined }));
      try {
        const res = await fetch("/api/demo/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: s }) });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setErrors((e) => ({ ...e, [s]: data.message ?? "Something went wrong." }));
        }
        router.refresh();
      } finally {
        setRunning(null);
      }
    });

  return (
    <Card className={isDemo ? "border-primary/30" : ""}>
      <CardHeader>
        <CardTitle>{isDemo ? "Play the story in 60 seconds" : "Guided demo"}</CardTitle>
        <CardDescription>
          Each button makes a real purchase request as your built-in agent, through the same rule checker and PayPal
          sandbox calls an MCP agent uses.{isDemo && " Your demo account uses a pre-linked sandbox buyer and expires in 24 hours."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(DEMO_SCENARIOS) as DemoScenario[]).map((key, i) => {
            const s = DEMO_SCENARIOS[key];
            const live = state[key];
            const badge = live ? PURCHASE_STATUS[live.status] : null;
            const payout = live?.status === "captured" ? PAYOUT_STATUS[live.payoutStatus] : "";
            const err = errors[key];
            return (
              <li key={key} className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">Step {i + 1}</p>
                <p className="font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground">
                  {s.detail} → <span className="text-foreground">{s.expect}</span>
                </p>
                <div className="mt-auto space-y-2 pt-1 text-xs">
                  {live && badge && (
                    <div className="space-y-1">
                      <Badge className={badge.className}>{badge.label}</Badge>
                      {payout && <p className="text-muted-foreground">{payout}</p>}
                      {(live.status === "blocked" || live.status === "pending_approval") && live.reason && (
                        <p className="text-muted-foreground">{live.reason}</p>
                      )}
                      <Link href={`/purchases/${live.purchaseId}`} className="block underline underline-offset-2">
                        See timeline
                      </Link>
                    </div>
                  )}
                  {err && (
                    <p role="alert" className="text-destructive">
                      {err}
                    </p>
                  )}
                  <Button size="sm" variant={live ? "outline" : "default"} className="w-full" disabled={running !== null} onClick={() => run(key)}>
                    {running === key ? "Agent is asking…" : live || err ? "Run again" : "Run"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Then approve or decline the held ones{telegram ? " here or in Telegram" : " above"}, refund the coffee, or revoke the built-in
          agent in the Agents panel and run a step again.
        </p>
      </CardContent>
    </Card>
  );
}
