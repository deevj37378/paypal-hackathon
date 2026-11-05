"use client";

import { AgIncompleteDataMappingOverlay, AgLoadingOverlay, AgNoDataOverlay } from "ag-studio-react";
import { useEffect, useState } from "react";

/**
 * Custom AG Studio widget: the deterministic rule checker's decisions as a flow.
 *   Requested → Approved by rules / Held for approval / Blocked by rules → Charged → Paid out
 * Clicking a decision cross-filters every other widget on the page (and again to clear).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Field = any;
type Params = {
  dataMapping: { decision?: Field[]; outcome?: Field[]; payout?: Field[]; count?: Field[] };
  widgetApi: any;
};

const DECISIONS = [
  { key: "Approved by rules", label: "Approved by rules", color: "#059669", note: "charged automatically" },
  { key: "Held for approval", label: "Held for approval", color: "#d97706", note: "owner asked first" },
  { key: "Blocked by rules", label: "Blocked by rules", color: "#dc2626", note: "never charged" },
] as const;

type Totals = { requested: number; byDecision: Record<string, number>; charged: number; heldApproved: number; refunded: number; paidOut: number };

/** Reads a row value for a field regardless of how the engine keys it (id, or id with aggregation). */
function read(row: Record<string, any>, field: Field) {
  if (!field) return undefined;
  // Resolved fields carry the row key ("purchases.id.countd"); fall back to the field id.
  for (const k of [field.key, field.id, field.fieldId, field.rootField?.id]) {
    if (typeof k === "string" && k in row) return row[k];
  }
  const id = String(field.id ?? field.fieldId ?? "");
  const k = id ? Object.keys(row).find((key) => key.startsWith(id)) : undefined;
  return k ? row[k] : undefined;
}

function summarise(rows: Record<string, any>[], m: Params["dataMapping"]): Totals {
  const t: Totals = { requested: 0, byDecision: {}, charged: 0, heldApproved: 0, refunded: 0, paidOut: 0 };
  for (const r of rows) {
    const n = Number(read(r, m.count?.[0]) ?? 0);
    const decision = String(read(r, m.decision?.[0]) ?? "");
    const outcome = String(read(r, m.outcome?.[0]) ?? "");
    const payout = String(read(r, m.payout?.[0]) ?? "");
    t.requested += n;
    t.byDecision[decision] = (t.byDecision[decision] ?? 0) + n;
    if (outcome.startsWith("Charged")) t.charged += n;
    if (outcome.startsWith("Charged after approval")) t.heldApproved += n;
    if (outcome.includes("refunded")) t.refunded += n;
    if (payout === "Paid out") t.paidOut += n;
  }
  return t;
}

function readSelection(widgetApi: any): string | null {
  try {
    const sel = widgetApi.getCrossFilterSelections?.();
    const first = Array.isArray(sel) ? sel[0] : sel;
    const v = first?.values?.[0] ?? first?.value ?? null;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "0%");

export function DecisionFlowWidget({ dataMapping, widgetApi }: Params) {
  const [totals, setTotals] = useState<Totals | null>(null);
  const complete = Boolean(dataMapping.decision?.[0] && dataMapping.outcome?.[0] && dataMapping.payout?.[0] && dataMapping.count?.[0]);

  useEffect(() => {
    if (!complete) return;
    let alive = true;
    const query = { fields: [dataMapping.decision![0], dataMapping.outcome![0], dataMapping.payout![0], dataMapping.count![0]] };
    // Ignore our own cross filter so the flow keeps showing every branch while one is selected.
    widgetApi
      .getData(query, {
        queryId: "flow",
        crossFilter: "none",
        onDataUpdated: (res: any) => alive && !res.replaced && setTotals(summarise(res.results.rows, dataMapping)),
      })
      .then((res: any) => {
        if (!alive || res.replaced) return;
        if (process.env.NODE_ENV !== "production" && res.results.rows[0]) console.debug("[decision-flow] row keys", Object.keys(res.results.rows[0]));
        setTotals(summarise(res.results.rows, dataMapping));
      });
    return () => {
      alive = false;
    };
  }, [complete, dataMapping, widgetApi]);

  // Studio re-renders a widget that reads its selection whenever the cross filter changes.
  const selected = readSelection(widgetApi);

  if (!complete) return <AgIncompleteDataMappingOverlay />;
  if (!totals) return <AgLoadingOverlay />;
  if (totals.requested === 0) return <AgNoDataOverlay />;

  const toggle = (value: string) => {
    widgetApi.toggleCrossFilter({ type: "value", field: dataMapping.decision![0], value, group: 0 });
  };

  return (
    <div className="flex h-full flex-col gap-2 px-1.5 pb-1 text-[13px]" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui" }}>
      <div className="grid flex-1 grid-cols-[1fr_1.4fr_1fr_1fr] items-stretch gap-2">
        <Stage title="Requested" value={totals.requested} sub="by agents" tone="#1e2f5a" />
        <div className="flex flex-col gap-1.5">
          {DECISIONS.map((d) => {
            const n = totals.byDecision[d.key] ?? 0;
            const active = selected === d.key;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => toggle(d.key)}
                aria-pressed={active}
                title={`Filter the dashboard to "${d.label}"`}
                className="group relative flex flex-1 items-center justify-between gap-2 overflow-hidden rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--muted)]"
                style={{ borderColor: active ? d.color : "var(--border)", boxShadow: active ? `inset 0 0 0 1px ${d.color}` : undefined }}
              >
                <span aria-hidden className="absolute inset-y-0 left-0 opacity-15" style={{ width: pct(n, totals.requested), background: d.color }} />
                <span className="relative min-w-0">
                  <span className="block truncate font-medium" style={{ color: d.color }}>
                    {d.label}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--muted-foreground)]">{d.note}</span>
                </span>
                <span className="relative text-right tabular-nums">
                  <span className="block font-semibold">{n}</span>
                  <span className="block text-[11px] text-[var(--muted-foreground)]">{pct(n, totals.requested)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <Stage
          title="Charged"
          value={totals.charged}
          sub={`${pct(totals.charged, totals.requested)} of requests · ${totals.heldApproved} after approval`}
          tone="#059669"
        />
        <Stage title="Paid out" value={totals.paidOut} sub={`${pct(totals.paidOut, totals.charged)} of charged · ${totals.refunded} refunded`} tone="#0284c7" />
      </div>
      <p className="text-[11px] text-[var(--muted-foreground)]">
        Every decision is made by Allowance&apos;s deterministic rule checker, not AI. Click a decision to filter the dashboard.
        {selected && (
          <>
            {" "}
            <button type="button" className="underline" onClick={() => toggle(selected)}>
              Clear filter
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function Stage({ title, value, sub, tone }: { title: string; value: number; sub: string; tone: string }) {
  return (
    <div className="relative flex flex-col justify-center rounded-lg border border-[var(--border)] px-3 py-2">
      <span aria-hidden className="absolute inset-y-2 left-0 w-1 rounded-r" style={{ background: tone }} />
      <span className="text-[11px] font-medium tracking-wide text-[var(--muted-foreground)] uppercase">{title}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] leading-tight text-[var(--muted-foreground)]">{sub}</span>
    </div>
  );
}

/** Widget definition for createWidgets(). */
export const decisionFlowDefinition = {
  id: "decision-flow",
  label: "Rule decisions",
  icon: {
    url: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1e2f5a" stroke-width="2"><path d="M3 12h4l3-6h4M10 12h4M10 12l3 6h4M14 6h7M14 12h7M17 18h4"/></svg>'),
  },
  dataMapping: {
    decision: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Rule decision field (purchases.ruleDecision)." },
    outcome: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Final outcome field (purchases.outcome)." },
    payout: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, required: true, aiDescription: "Payout status field (purchases.payoutStatus)." },
    count: { type: "field", supportedRoles: ["numeric"], requires: { cardinality: "one" }, required: true, aiDescription: "Count of purchases (purchases.id, countd)." },
  },
  // Edit-panel form: Studio's default sections plus our four field pickers.
  form: (params: any) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "decision", label: "Rule decision" },
        { key: "outcome", label: "Outcome" },
        { key: "payout", label: "Payout status" },
        { key: "count", label: "Purchases (count)" },
      ],
    }),
  comp: DecisionFlowWidget,
  defaultSize: { width: 900, height: 260 },
  minSize: { width: 520, height: 200 },
  ai: { description: "Flow of the rule checker's decisions: requested, approved/held/blocked, charged, paid out. Click a decision to cross-filter." },
};
