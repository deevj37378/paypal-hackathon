"use client";

import { AgStudioAiModule, enableStudioDevValidations, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AnalyticsData } from "@/lib/analytics/data";
import { buildAi } from "./studio/ai";
import { buildStudioData } from "./studio/data";
import { decisionFlowDefinition } from "./studio/decision-flow-widget";
import type { AllowanceRegistry, DecisionFlowDefinition } from "./studio/registry";
import { defaultReport } from "./studio/report";
import { allowanceTheme } from "./studio/theme";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

/** The page's one Studio instance, read later by the AI guard (set when Studio's API is ready). */
const liveStudio: { api: AgStudioApi | null } = { api: null };

export default function StudioClient({ data, licenseKey, aiEnabled }: { data: AnalyticsData; licenseKey?: string; aiEnabled: boolean }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const studioData = useMemo(() => buildStudioData(data), [data]);
  // Per-browser session for the AI assistant (the bridge refuses requests without it).
  useEffect(() => {
    if (aiEnabled) fetch("/api/studio-ai/session", { method: "POST" }).catch(() => {});
  }, [aiEnabled]);
  const ai = useMemo(() => (aiEnabled ? buildAi(data, () => liveStudio.api) : undefined), [aiEnabled, data]);
  // Bring widgets the assistant adds into view and highlight them (they land at the bottom).
  const knownWidgets = useRef<Set<string> | null>(null);
  const seenEls = useRef(new WeakSet<Element>());
  const highlightNewWidgets = (state: { selectedPageId?: string; pages?: { id: string; widgets?: Record<string, unknown> }[] }) => {
    const page = state.pages?.find((p) => p.id === state.selectedPageId);
    const ids = Object.keys(page?.widgets ?? {});
    if (!knownWidgets.current) {
      knownWidgets.current = new Set(ids);
      document.querySelectorAll(".ag-studio-layout-widget").forEach((el) => seenEls.current.add(el));
      return;
    }
    const added = ids.filter((id) => !knownWidgets.current!.has(id));
    ids.forEach((id) => knownWidgets.current!.add(id));
    if (!added.length) return;
    setTimeout(() => {
      const fresh = [...document.querySelectorAll(".ag-studio-layout-widget")].filter((el) => !seenEls.current.has(el));
      fresh.forEach((el) => seenEls.current.add(el));
      const el = fresh.at(-1);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("alw-new-widget");
      void (el as HTMLElement).offsetWidth;
      el.classList.add("alw-new-widget");
    }, 600);
  };
  const widgets = useMemo(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (config: any) =>
        createWidgets<AllowanceRegistry>({
          additionalTypes: [decisionFlowDefinition as unknown as DecisionFlowDefinition],
          menu: [...config.menu, { label: "Allowance", widgetIds: ["decision-flow"] }],
        }),
    [],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-2 text-sm">
        <p className="text-muted-foreground">
          {data.purchases.length} agent requests · updated {new Date(data.asOf).toUTCString().slice(5, 22)} UTC
          {aiEnabled && (mode === "view" ? " · Switch to Edit layout to ask the AI assistant for a chart" : " · AI assistant is in the left panel")}
        </p>
        <div role="group" aria-label="Dashboard mode" className="flex gap-1 rounded-lg border p-0.5">
          {(["view", "edit"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {m === "view" ? "View" : "Edit layout"}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio<AllowanceRegistry>
            style={{ height: "100%", width: "100%" }}
            theme={allowanceTheme}
            layout={{ widgetBorderEnabled: true }}
            data={studioData}
            initialState={defaultReport}
            widgets={widgets}
            ai={ai}
            mode={mode}
            onStudioReady={(e) => highlightNewWidgets((e.api as unknown as AgStudioApi).getState() as never)}
            onStateUpdated={(e) => highlightNewWidgets(e.state as never)}
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as AgStudioApi;
              liveStudio.api = apiRef.current;
              // Read-only debugging/inspection hook (the report state is public data).
              (window as unknown as { allowanceStudio?: AgStudioApi }).allowanceStudio = apiRef.current;
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
