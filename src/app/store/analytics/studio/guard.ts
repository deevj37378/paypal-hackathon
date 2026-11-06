import type { AgAiTool, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgStudioApi } from "ag-studio";
import type { AnalyticsData, PurchaseRow } from "@/lib/analytics/data";

/**
 * Guard rails for the dashboard assistant, all computed from the rows already on the page:
 *  - a catalog of the exact stored values of every categorical field (given to the model),
 *  - filter values checked against it (obvious label → value mapping, otherwise a clear error),
 *  - a row count for any widget (its page + widget filters evaluated on the real data),
 *  - a final check so the assistant never ends with an empty chart and a "done" message.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const BASE_WIDGETS = ["kpi-requests", "kpi-charged", "kpi-paid-out", "kpi-refunded", "agent", "flow", "outcome-by-agent", "block-reasons", "spend-by-category", "payouts", "recent"];

const CATEGORICAL = ["ruleDecision", "outcome", "blockReason", "holdReason", "category", "agentType", "payoutStatus", "merchant"] as const;

export type Catalog = Record<string, string[]>;

export function buildCatalog(data: AnalyticsData): Catalog {
  const out: Catalog = {};
  for (const f of CATEGORICAL) {
    out[`purchases.${f}`] = [...new Set(data.purchases.map((p) => String(p[f as keyof PurchaseRow] ?? "")))].filter(Boolean).sort();
  }
  out["items.category"] = [...new Set(data.items.map((i) => i.category))].sort();
  out["items.product"] = [...new Set(data.items.map((i) => i.product))].sort();
  return out;
}

export function describeCatalog(c: Catalog) {
  return Object.entries(c)
    .filter(([k]) => k.startsWith("purchases."))
    .map(([k, vs]) => `- ${k}: ${vs.map((v) => JSON.stringify(v)).join(", ")}`)
    .join("\n");
}

const norm = (s: string) => s.replace(/​/g, "").trim().toLowerCase();

/** Map a value onto a stored value: exact, case-insensitive, or one unambiguous partial match. */
export function resolveValue(value: string, known: string[]): string | null {
  if (known.includes(value)) return value;
  const n = norm(value);
  const ci = known.filter((k) => norm(k) === n);
  if (ci.length === 1) return ci[0];
  const partial = known.filter((k) => norm(k).includes(n) || n.includes(norm(k)));
  return partial.length === 1 ? partial[0] : null;
}

/** Check (and fix where obvious) the values of a filter tool call. Returns args or an error message. */
export function checkFilterArgs(args: any, catalog: Catalog): { args: any } | { error: string } {
  const fieldId: string | undefined = args?.value?.field?.id;
  const known = fieldId ? catalog[fieldId] : undefined;
  if (!known || !args?.value?.model) return { args };
  const bad: string[] = [];
  const fix = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    const r = resolveValue(v, known);
    if (r === null) bad.push(v);
    return r ?? v;
  };
  const walk = (m: any): any => {
    if (!m || typeof m !== "object") return m;
    const out = { ...m };
    if (Array.isArray(out.conditions)) out.conditions = out.conditions.map(walk);
    if ("value" in out) out.value = Array.isArray(out.value) ? out.value.map(fix) : fix(out.value);
    return out;
  };
  const model = walk(args.value.model);
  if (bad.length) {
    return { error: `${bad.map((b) => JSON.stringify(b)).join(", ")} is not a stored value of ${fieldId}. Use one of exactly: ${known.map((k) => JSON.stringify(k)).join(", ")}.` };
  }
  return { args: { ...args, value: { ...args.value, model } } };
}

// --- Evaluating filters on the page's rows ------------------------------------------

function matches(row: PurchaseRow, fieldId: string | undefined, m: any): boolean | null {
  if (!m) return true;
  const op = m.operator;
  if (op === "AND" || op === "OR") {
    const rs = (m.conditions ?? []).map((c: any) => matches(row, fieldId, c));
    if (rs.some((r: boolean | null) => r === null)) return null;
    return op === "AND" ? rs.every(Boolean) : rs.some(Boolean);
  }
  if (!fieldId?.startsWith("purchases.")) return null; // other tables: don't guess
  const raw = (row as any)[fieldId.slice("purchases.".length)];
  if (raw === undefined) return null;
  const isDate = fieldId === "purchases.date" || fieldId === "purchases.createdAt";
  const val: any = isDate ? String(raw).slice(0, 10) : raw;
  const cmp = (x: unknown): any => (isDate ? String(x).slice(0, 10) : x);
  const v = m.value;
  switch (op) {
    case "equals":
      return Array.isArray(v) ? v.map(cmp).includes(val) : val === cmp(v);
    case "notEqual":
      return val !== cmp(v);
    case "isIn":
      return (Array.isArray(v) ? v : [v]).map(cmp).includes(val);
    case "notIn":
    case "isNotIn":
      return !(Array.isArray(v) ? v : [v]).map(cmp).includes(val);
    case "contains":
      return String(val).toLowerCase().includes(String(v).toLowerCase());
    case "isTrue":
      return Boolean(val);
    case "isFalse":
      return !val;
    case "isBlank":
      return val === null || val === "";
    case "isNotBlank":
      return !(val === null || val === "");
    case "greaterThan":
      return val > cmp(v);
    case "greaterThanOrEqual":
      return val >= cmp(v);
    case "lessThan":
      return val < cmp(v);
    case "lessThanOrEqual":
      return val <= cmp(v);
    case "between":
      return Array.isArray(v) && val >= cmp(v[0]) && val <= cmp(v[1]);
    default:
      return null; // unknown operator (e.g. relative dates): can't tell
  }
}

export type WidgetCheck = { id: string; title: string; rows: number; measureTotal: number | null };

/** Rows and measure total for one widget after page + widget filters; null when we can't evaluate. */
export function checkWidget(api: AgStudioApi, rows: PurchaseRow[], widgetId: string): WidgetCheck | null {
  const s: any = api.getState();
  const page = s?.pages?.find((p: any) => p.id === s.selectedPageId);
  const w = page?.widgets?.[widgetId];
  if (!w) return null;
  const filters = [...(page.filter?.page ?? []), ...(page.filter?.widget?.[widgetId] ?? [])].filter((f: any) => f?.model);
  let unknown = false;
  const kept = rows.filter((r) =>
    filters.every((f: any) => {
      const res = matches(r, f.field?.id, f.model);
      if (res === null) unknown = true;
      return res !== false;
    }),
  );
  if (unknown) return null;
  const measure = w.dataMapping?.valueKey?.[0] ?? w.dataMapping?.value?.[0];
  let measureTotal: number | null = null;
  if (measure?.id?.startsWith("purchases.") && measure.aggregation === "sum") {
    const key = measure.id.slice("purchases.".length);
    measureTotal = kept.reduce((t, r) => t + Number((r as any)[key] ?? 0), 0);
  }
  return { id: widgetId, title: w.format?.title?.text ?? widgetId, rows: kept.length, measureTotal };
}

const emptyReason = (c: WidgetCheck) =>
  c.rows === 0 ? "0 rows match its filters" : c.measureTotal === 0 ? `all ${c.rows} matching rows have 0 for its value field` : null;

/** Widgets the assistant added that would render no data. */
export function emptyNewWidgets(api: AgStudioApi, rows: PurchaseRow[]) {
  const s: any = api.getState();
  const page = s?.pages?.find((p: any) => p.id === s.selectedPageId);
  return Object.keys(page?.widgets ?? {})
    .filter((id) => !BASE_WIDGETS.includes(id))
    .map((id) => checkWidget(api, rows, id))
    .filter((c): c is WidgetCheck => Boolean(c && emptyReason(c)));
}

// --- Tool wrappers ----------------------------------------------------------------------

/**
 * Wrap a Studio tool's execute. Explicit delegation (every method bound to the original tool):
 * Studio's tools keep private state, so a prototype-based copy breaks their advertised schema.
 */
function wrapTool(tool: AgAiTool, around: (call: any, ctx: any, run: (call: any) => Promise<any>) => Promise<any>): AgAiTool {
  if (!tool.execute) return tool;
  const inner = tool.execute.bind(tool);
  const t = tool as any;
  const delegated: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(t), ...Object.getOwnPropertyNames(Object.getPrototypeOf(t) ?? {})])) {
    if (key === "constructor") continue;
    const v = t[key];
    delegated[key] = typeof v === "function" ? v.bind(tool) : v;
  }
  return { ...delegated, name: tool.name, description: tool.description, kind: tool.kind, schema: () => tool.schema(), execute: (call: any, ctx: any) => around(call, ctx, (c) => inner(c, ctx)) } as AgAiTool;
}

/** Filter tools: validate/map values first; afterwards report if the widget became empty. */
export function guardFilterTool(tool: AgAiTool, catalog: Catalog, getApi: () => AgStudioApi | null, rows: PurchaseRow[]) {
  return wrapTool(tool, async (call, _ctx, run) => {
    const checked = checkFilterArgs(call.args, catalog);
    if ("error" in checked) return { success: false, issues: [{ message: checked.error }] };
    const res = await run({ ...call, args: checked.args });
    return withEmptyNote(res, call.args?.widgetId, getApi, rows);
  });
}

/** Configure tools: afterwards report if the widget renders no data. */
export function guardConfigureTool(tool: AgAiTool, getApi: () => AgStudioApi | null, rows: PurchaseRow[]) {
  return wrapTool(tool, async (call, _ctx, run) => withEmptyNote(await run(call), call.args?.widgetId, getApi, rows));
}

function withEmptyNote(res: any, widgetId: string | undefined, getApi: () => AgStudioApi | null, rows: PurchaseRow[]) {
  const api = getApi();
  if (!res?.success || !widgetId || !api) return res;
  const c = checkWidget(api, rows, widgetId);
  const why = c && emptyReason(c);
  if (!why) return res;
  return {
    ...res,
    response: `${res.response}\nWARNING: this widget currently shows NO DATA (${why}). Fix the filter with exact stored values or remove it, so the chart shows data.`,
  };
}

// --- Final-answer check -----------------------------------------------------------------

/**
 * Adapter wrapper: when the model ends its run (a turn with no tool calls) while a widget it added
 * is empty, hold that answer back and run one follow-up turn asking it to fix the widget.
 */
export function withResultCheck(inner: AgLlmAdapter, check: () => string | null): AgLlmAdapter {
  const nudged = new Set<string>();
  return {
    executeTurn(request: AgLlmRequest, options?: { signal?: AbortSignal }) {
      let resolveComplete!: (r: AgLlmResponse) => void;
      let rejectComplete!: (e: Error) => void;
      const complete = new Promise<AgLlmResponse>((res, rej) => {
        resolveComplete = res;
        rejectComplete = rej;
      });
      complete.catch(() => {});
      async function* run() {
        try {
          const first = inner.executeTurn(request, options);
          const buffered: any[] = [];
          for await (const ev of first.stream) buffered.push(ev);
          const res = await first.complete;
          const ended = !res.output.some((o: any) => o.type === "function_call");
          const problem = ended ? check() : null;
          if (!problem || nudged.has(problem)) {
            yield* buffered;
            resolveComplete(res);
            return;
          }
          nudged.add(problem);
          const followUp: AgLlmRequest = {
            ...request,
            input: [
              ...request.input,
              ...(res.output as any[]),
              { kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: problem }] } as any,
            ],
          };
          const second = inner.executeTurn(followUp, options);
          for await (const ev of second.stream) yield ev;
          resolveComplete(await second.complete);
        } catch (e) {
          rejectComplete(e instanceof Error ? e : new Error(String(e)));
          throw e;
        }
      }
      const it = run();
      return { stream: { [Symbol.asyncIterator]: () => it }, complete } as ReturnType<AgLlmAdapter["executeTurn"]>;
    },
  };
}
