import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { getSessionUserId } from "@/lib/session";
import { AgentsPanel } from "@/app/dashboard/agents-panel";
import { ConnectInstructions } from "./connect-instructions";

export const metadata = { title: "Agents · Allowance" };

export default function Page() {
  return (
    <AppShell active="agents">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-muted-foreground">Give an AI agent its own key. It can only spend within your rules.</p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl border bg-muted/40" />}>
        <AgentsContent />
      </Suspense>
    </AppShell>
  );
}

async function AgentsContent() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const agents = await db().select().from(schema.agents).where(eq(schema.agents.userId, userId)).orderBy(desc(schema.agents.createdAt));
  const mcpUrl = `${env().APP_URL}/api/mcp`;
  const LATEST_BUILTIN = agents.find((a) => a.keyPrefix === "builtin")?.id;
  return (
    <>
      <AgentsPanel
        full
        mcpUrl={mcpUrl}
        agents={agents.map((a) => ({
          id: a.id,
          name: a.name,
          keyLast4: a.keyLast4,
          status: a.status,
          lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
          builtIn: a.keyPrefix === "builtin",
          isLatestBuiltIn: a.id === LATEST_BUILTIN,
        }))}
      />
      <Card>
        <CardHeader>
          <CardTitle>How to connect</CardTitle>
          <CardDescription>
            Allowance is an MCP server with four tools: search_store, get_allowance_status, request_purchase and
            get_purchase_status. Create a key above to get these steps with your key filled in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectInstructions mcpUrl={mcpUrl} />
        </CardContent>
      </Card>
    </>
  );
}
