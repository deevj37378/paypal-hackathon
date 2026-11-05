"use client";

import { AgStudioAiModule, enableStudioDevValidations, type AgStudioApi, type AgStudioMode } from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { useMemo, useRef, useState } from "react";
import type { AnalyticsData } from "@/lib/analytics/data";
import { buildAi } from "./studio/ai";
import { buildStudioData } from "./studio/data";
import { decisionFlowDefinition } from "./studio/decision-flow-widget";
import type { AllowanceRegistry, DecisionFlowDefinition } from "./studio/registry";
import { defaultReport } from "./studio/report";
import { allowanceTheme } from "./studio/theme";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

export default function StudioClient({ data, licenseKey, aiEnabled }: { data: AnalyticsData; licenseKey?: string; aiEnabled: boolean }) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const studioData = useMemo(() => buildStudioData(data), [data]);
  const ai = useMemo(() => (aiEnabled ? buildAi() : undefined), [aiEnabled]);
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
          {aiEnabled && " · Ask the assistant (AI icon) for a new widget"}
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
            onApiReady={(e) => {
              apiRef.current = e.api as unknown as AgStudioApi;
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}
