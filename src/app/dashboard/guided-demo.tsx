"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_SCENARIOS, type DemoScenario } from "@/lib/demo";
import { PURCHASE_STATUS } from "@/lib/purchases/labels";

type Result = { purchase_id?: string; status?: string; summary?: string; message?: string; reasons?: string[] };

export function GuidedDemo({ isDemo, telegram }: { isDemo: boolean; telegram: boolean }) {
  const router = useRouter();
  const [results, setResults] = useState<Partial<Record<DemoScenario, Result>>>({});
  const [running, setRunning] = useState<DemoScenario | null>(null);
  const [, start] = useTransition();

  const run = (s: DemoScenario) =>
    start(async () => {
      setRunning(s);
      try {
        const res = await fetch("/api/demo/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: s }) });
        const data = (await res.json().catch(() => ({}))) as Result;
        setResults((r) => ({ ...r, [s]: res.ok ? data : { message: data.message ?? "Something went wrong." } }));
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
            const r = results[key];
            const statusKey = r?.status === "approved" ? "captured" : r?.status;
            const badge = statusKey ? PURCHASE_STATUS[statusKey] : null;
            return (
              <li key={key} className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">Step {i + 1}</p>
                <p className="font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground">
                  {s.detail} → <span className="text-foreground">{s.expect}</span>
                </p>
                <div className="mt-auto pt-1">
                  {r ? (
                    <div className="space-y-1.5 text-xs">
                      {badge ? <Badge className={badge.className}>{badge.label}</Badge> : <p className="text-destructive">{r.message}</p>}
                      {r.reasons?.[0] && <p className="text-muted-foreground">{r.reasons[0]}</p>}
                      {r.purchase_id && (
                        <Link href={`/purchases/${r.purchase_id}`} className="block underline underline-offset-2">
                          See timeline
                        </Link>
                      )}
                    </div>
                  ) : (
                    <Button size="sm" className="w-full" disabled={running !== null} onClick={() => run(key)}>
                      {running === key ? "Agent is asking…" : "Run"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Then approve or decline the held ones{telegram ? " here or in Telegram" : " above"}, refund the coffee, or revoke the agent in
          the Agents panel and try again.
        </p>
      </CardContent>
    </Card>
  );
}
