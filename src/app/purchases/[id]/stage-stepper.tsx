import { Check, Circle, Clock, X } from "lucide-react";

type Stage = { label: string; state: "done" | "current" | "failed" | "skipped" | "todo"; note?: string };

/** requested → rule check → approval → charged → paid out, derived from the purchase's state. */
export function stagesFor(p: { status: string; payoutStatus: string; decision: { outcome: string } }): Stage[] {
  const charged = ["captured", "refunded"].includes(p.status);
  const neededApproval = p.decision.outcome === "pending_approval";
  const approval: Stage =
    p.status === "pending_approval"
      ? { label: "Your approval", state: "current", note: "Waiting for you" }
      : p.status === "declined"
        ? { label: "Your approval", state: "failed", note: "Declined" }
        : p.status === "expired"
          ? { label: "Your approval", state: "failed", note: "Expired" }
          : neededApproval
            ? { label: "Your approval", state: "done", note: "Approved" }
            : { label: "Your approval", state: "skipped", note: "Not needed" };
  const payout: Stage =
    p.status === "refunded"
      ? { label: "Store paid", state: "skipped", note: "Refunded" }
      : p.payoutStatus === "paid"
        ? { label: "Store paid", state: "done", note: "PayPal Payouts" }
        : p.payoutStatus === "failed" || p.payoutStatus === "cancelled"
          ? { label: "Store paid", state: "failed", note: p.payoutStatus === "cancelled" ? "Cancelled" : "Failed" }
          : ["scheduled", "processing", "sent"].includes(p.payoutStatus)
            ? { label: "Store paid", state: "current", note: p.payoutStatus === "scheduled" ? "Refund window" : "Sending" }
            : { label: "Store paid", state: "todo" };
  return [
    { label: "Requested", state: "done", note: "By your agent" },
    p.status === "blocked"
      ? { label: "Rule check", state: "failed", note: "Blocked" }
      : { label: "Rule check", state: "done", note: neededApproval ? "Needs approval" : "All rules pass" },
    p.status === "blocked" ? { label: "Your approval", state: "todo" } : approval,
    charged
      ? { label: "Charged", state: "done", note: p.status === "refunded" ? "Then refunded" : "Saved PayPal" }
      : p.status === "processing"
        ? { label: "Charged", state: "current", note: "Processing" }
        : p.status === "failed"
          ? { label: "Charged", state: "failed", note: "Failed" }
          : { label: "Charged", state: "todo" },
    payout,
  ];
}

const STYLE = {
  done: { icon: Check, ring: "bg-emerald-600 text-white", text: "" },
  current: { icon: Clock, ring: "bg-amber-500 text-white", text: "" },
  failed: { icon: X, ring: "bg-red-600 text-white", text: "" },
  skipped: { icon: Circle, ring: "bg-muted text-muted-foreground", text: "text-muted-foreground" },
  todo: { icon: Circle, ring: "border bg-background text-muted-foreground", text: "text-muted-foreground" },
} as const;

export function StageStepper({ stages }: { stages: Stage[] }) {
  return (
    <ol aria-label="Purchase progress" className="grid grid-cols-5 gap-1">
      {stages.map((s, i) => {
        const st = STYLE[s.state];
        const Icon = st.icon;
        return (
          <li key={s.label} className="relative flex flex-col items-center text-center">
            {i > 0 && <span aria-hidden className="absolute top-3.5 right-1/2 h-px w-full bg-border" />}
            <span className={`relative z-10 grid size-7 place-items-center rounded-full ${st.ring}`}>
              <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
            </span>
            <span className={`mt-1.5 text-xs font-medium ${st.text}`}>{s.label}</span>
            {s.note && <span className="text-[11px] leading-tight text-muted-foreground">{s.note}</span>}
            <span className="sr-only">: {s.state}</span>
          </li>
        );
      })}
    </ol>
  );
}
