"use client";

import { useEffect, useState } from "react";

/** Loads the AI explanation after mount; shows the checker's reasons if the AI is unavailable. */
export function Explanation({ purchaseId, fallback }: { purchaseId: string; fallback: string }) {
  const [state, setState] = useState<{ text: string; source: "ai" | "rules" } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/purchases/${purchaseId}/explanation`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setState(d?.text ? d : { text: fallback, source: "rules" }))
      .catch(() => alive && setState({ text: fallback, source: "rules" }));
    return () => {
      alive = false;
    };
  }, [purchaseId, fallback]);

  if (!state) return <p className="h-14 animate-pulse rounded-lg bg-muted/50" aria-label="Loading explanation" />;
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{state.source === "ai" ? "In plain English (AI)" : "Why"}</p>
      <p className="mt-1">{state.text}</p>
      {state.source === "ai" && <p className="mt-1 text-xs text-muted-foreground">Explanation only. The decision itself was made by the rule checker.</p>}
    </div>
  );
}
