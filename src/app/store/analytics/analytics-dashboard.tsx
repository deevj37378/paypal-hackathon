"use client";

import dynamic from "next/dynamic";
import type { AnalyticsData } from "@/lib/analytics/data";

/** AG Studio needs the browser (window, layout), so it is loaded client-side only. */
const StudioClient = dynamic(() => import("./studio-client"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-muted/40" aria-label="Loading dashboard" />,
});

export function AnalyticsDashboard(props: { data: AnalyticsData; licenseKey?: string; aiEnabled: boolean }) {
  return <StudioClient {...props} />;
}
