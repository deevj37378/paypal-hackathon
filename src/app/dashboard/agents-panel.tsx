"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectInstructions } from "@/app/agents/connect-instructions";

export type AgentRow = { id: string; name: string; keyLast4: string | null; status: string; lastUsedAt: string | null; builtIn?: boolean };

export function AgentsPanel({ agents, mcpUrl, full = false }: { agents: AgentRow[]; mcpUrl: string; full?: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("Claude Desktop");
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const active = agents.filter((a) => a.status === "active");

  const create = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.message ?? "Couldn't create the agent.");
      setNewKey({ name: data.name, key: data.key });
      router.refresh();
    });

  const revoke = (id: string, agentName: string) =>
    start(async () => {
      if (!confirm(`Revoke ${agentName}? Its key stops working immediately.`)) return;
      const res = await fetch(`/api/agents/${id}/revoke`, { method: "POST" });
      if (!res.ok) setError("Couldn't revoke. Try again.");
      router.refresh();
    });

  const revokeAll = () =>
    start(async () => {
      if (!confirm("Revoke ALL agents? Every key stops working immediately.")) return;
      const res = await fetch("/api/agents/revoke-all", { method: "POST" });
      if (!res.ok) setError("Couldn't revoke. Try again.");
      setNewKey(null);
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>Each agent gets its own key. Revoke one and it loses access on its very next request.</CardDescription>
        {active.length > 0 && (
          <CardAction>
            <Button variant="destructive" size="sm" disabled={pending} onClick={revokeAll}>
              Revoke all
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {full && (
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="agent-name">Agent name</Label>
              <Input id="agent-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
            </div>
            <Button type="submit" disabled={pending || !name.trim()}>
              Create key
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {newKey && (
          <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
            <div className="space-y-2">
              <p className="font-medium text-emerald-900">
                Key for {newKey.name}. Copy it now: you won&apos;t see it again.
              </p>
              <CopyField value={newKey.key} label="API key" />
            </div>
            <ConnectInstructions mcpUrl={mcpUrl} apiKey={newKey.key} />
          </div>
        )}

        {agents.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No agents yet.{" "}
            {full ? "Create a key above to connect one." : <Link href="/agents" className="underline">Connect your first agent</Link>}
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-medium">
                    {a.name}
                    {a.builtIn && <Badge variant="secondary">Built-in</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.builtIn ? "Runs inside Allowance" : <>Key ending <code className="font-mono">…{a.keyLast4 ?? "????"}</code></>} ·{" "}
                    {a.lastUsedAt ? `last used ${new Date(a.lastUsedAt).toLocaleString()}` : "never used"}
                  </p>
                </div>
                {a.status === "active" ? (
                  <Button variant="destructive" size="sm" disabled={pending} onClick={() => revoke(a.id, a.name)} aria-label={`Revoke ${a.name}`}>
                    Revoke
                  </Button>
                ) : (
                  <Badge variant="outline">Revoked</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
        {!full && (
          <Link href="/agents" className="inline-block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Add an agent or see how to connect Claude
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <code aria-label={label} className="flex-1 overflow-x-auto rounded-md border bg-background px-2 py-1.5 font-mono text-xs whitespace-pre">
        {value}
      </code>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
