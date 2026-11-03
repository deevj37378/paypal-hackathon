"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type AgentRow = { id: string; name: string; keyPrefix: string; status: string; lastUsedAt: string | null };

export function AgentsPanel({ agents }: { agents: AgentRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("My shopping agent");
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
      await fetch(`/api/agents/${id}/revoke`, { method: "POST" });
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>Each agent gets its own key. Revoke one and it loses access instantly.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <div className="flex-1 space-y-1">
            <Label htmlFor="agent-name">Agent name</Label>
            <Input id="agent-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
          </div>
          <Button type="submit" disabled={pending || !name.trim()}>
            Create key
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}

        {newKey && (
          <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-medium text-emerald-900">Key for {newKey.name}. Copy it now; it won&apos;t be shown again.</p>
            <div className="flex gap-2">
              <code className="flex-1 overflow-x-auto rounded bg-white px-2 py-1 font-mono text-xs">{newKey.key}</code>
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(newKey.key)}>
                Copy
              </Button>
            </div>
          </div>
        )}

        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No agents yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code>{a.keyPrefix}…</code> · {a.lastUsedAt ? `last used ${new Date(a.lastUsedAt).toLocaleString()}` : "never used"}
                  </p>
                </div>
                {a.status === "active" ? (
                  <Button variant="destructive" size="sm" disabled={pending} onClick={() => revoke(a.id, a.name)}>
                    Revoke
                  </Button>
                ) : (
                  <Badge variant="secondary">Revoked</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
