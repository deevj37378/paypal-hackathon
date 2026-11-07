import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { aiConfigured } from "@/lib/ai/model";
import { getBuiltinAgent } from "@/lib/agents";
import { getSessionUserId } from "@/lib/session";
import { getActiveVault, getUser } from "@/lib/users";
import { AgentChat } from "./agent-chat";

export const metadata = { title: "Try the agent · Allowance" };

export default function Page() {
  return (
    <AppShell active="chat">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Try the agent</h1>
        <p className="text-sm text-muted-foreground">
          A built-in shopping agent with the same four tools Claude gets over MCP. It can ask to spend, but your rules
          decide.
        </p>
      </div>
      <Suspense fallback={<div className="h-[28rem] animate-pulse rounded-xl border bg-muted/40" />}>
        <ChatContent />
      </Suspense>
    </AppShell>
  );
}

async function ChatContent() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const [agent, vault, user] = await Promise.all([getBuiltinAgent(userId), getActiveVault(userId), getUser(userId)]);
  return (
    <AgentChat
      available={aiConfigured()}
      revoked={agent?.status === "revoked"}
      paypalLinked={Boolean(vault)}
      telegram={Boolean(user?.telegramChatId)}
    />
  );
}
