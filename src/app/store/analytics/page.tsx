import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteHeader } from "@/components/app/site-header";
import { getAnalyticsData } from "@/lib/analytics/data";
import { env } from "@/lib/env";
import { AnalyticsDashboard } from "./analytics-dashboard";

export const metadata = { title: "Agent commerce analytics · Bean & Page" };

export default function AnalyticsPage() {
  return (
    <>
      <SiteHeader wide>
        <nav aria-label="Store" className="flex items-center gap-4 text-sm">
          <Link href="/store" className="text-muted-foreground hover:text-foreground">
            Storefront
          </Link>
          <Link href="/store/merchant" className="text-muted-foreground hover:text-foreground">
            Merchant view
          </Link>
        </nav>
      </SiteHeader>
      <main className="flex flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl space-y-1 px-6 pt-6 pb-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Merchant analytics · built with AG Studio</p>
          <h1 className="text-2xl font-semibold tracking-tight">What AI agents are buying, and what the rules decided</h1>
          <p className="text-sm text-muted-foreground">
            Live from Allowance&apos;s database. Click a decision in the flow to filter everything, switch to Edit layout to rearrange, or ask
            the assistant for a new chart. The assistant can only build charts; it can&apos;t buy or refund anything.
          </p>
        </div>
        <div className="mx-auto h-[calc(100svh-11rem)] min-h-[640px] w-full max-w-6xl overflow-hidden rounded-t-xl border border-b-0 bg-background">
          <Suspense fallback={<div className="h-full animate-pulse bg-muted/40" />}>
            <Data />
          </Suspense>
        </div>
      </main>
    </>
  );
}

async function Data() {
  await connection();
  const data = await getAnalyticsData();
  const e = env();
  return <AnalyticsDashboard data={data} licenseKey={e.AG_STUDIO_LICENSE_KEY} aiEnabled={Boolean(e.GROQ_API_KEY)} />;
}
