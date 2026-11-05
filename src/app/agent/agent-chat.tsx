"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PURCHASE_STATUS } from "@/lib/purchases/labels";

const STARTERS = [
  "Restock my coffee and get the book I mentioned.",
  "What can you spend for me this month?",
  "Buy me a ceramic mug.",
  "Order 2 bags of the Ethiopia coffee.",
];

type ToolOut = { summary?: string; data?: Record<string, unknown> & { purchase_id?: string; status?: string; total?: string }; error?: string };

const TOOL_LABEL: Record<string, string> = {
  get_allowance_status: "Checked your budget",
  search_store: "Searched the store",
  request_purchase: "Asked to buy",
  get_purchase_status: "Checked a purchase",
};

export function AgentChat({ available, revoked, paypalLinked }: { available: boolean; revoked: boolean; paypalLinked: boolean }) {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop } = useChat({ transport: new DefaultChatTransport({ api: "/api/agent/chat" }) });
  const busy = status === "submitted" || status === "streaming";
  const bottom = useRef<HTMLDivElement>(null);
  // Block body: Chrome's scrollIntoView can return a Promise, which React would call as the effect cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (!available || revoked) {
    return (
      <Card>
        <CardContent className="space-y-3 text-sm">
          <p>{revoked ? "You revoked the built-in assistant, so it can't shop for you." : "The built-in agent is offline because the AI provider is unavailable."}</p>
          <Link href="/agents" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {revoked ? "Manage agents" : "Connect Claude via MCP instead"}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    sendMessage({ text });
    setInput("");
  };

  return (
    <Card className="flex min-h-[28rem] flex-col">
      <CardContent className="flex flex-1 flex-col gap-4">
        {!paypalLinked && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            PayPal isn&apos;t linked, so every purchase will be blocked. <Link href="/link-paypal" className="underline">Link PayPal</Link>
          </p>
        )}
        <div className="flex-1 space-y-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">Try one of these:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {STARTERS.map((s) => (
                  <Button key={s} variant="outline" size="sm" onClick={() => send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
              {m.parts.map((part, i) => {
                const key = `${m.id}-${i}`;
                if (part.type === "text") {
                  return m.role === "user" ? (
                    <p key={key} className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                      {part.text}
                    </p>
                  ) : (
                    <p key={key} className="max-w-[90%] text-sm leading-relaxed whitespace-pre-wrap">
                      {part.text}
                    </p>
                  );
                }
                if (part.type.startsWith("tool-")) {
                  const name = part.type.slice(5);
                  const p = part as { state: string; output?: ToolOut; input?: Record<string, unknown> };
                  return <ToolCard key={key} name={name} state={p.state} output={p.output} />;
                }
                return null;
              })}
            </div>
          ))}
          {status === "submitted" && <p className="text-sm text-muted-foreground">Thinking…</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {friendlyError(error.message)}
            </p>
          )}
          <div ref={bottom} />
        </div>
        <form
          className="flex gap-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <label htmlFor="chat-input" className="sr-only">
            Message the agent
          </label>
          <input
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the agent to buy something…"
            maxLength={500}
            className="h-9 flex-1 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {busy ? (
            <Button type="button" variant="outline" onClick={() => stop()}>
              Stop
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()}>
              Send
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function ToolCard({ name, state, output }: { name: string; state: string; output?: ToolOut }) {
  const label = TOOL_LABEL[name] ?? name;
  if (state !== "output-available") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
        {label}…
      </div>
    );
  }
  if (output?.error) {
    return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{label}: {output.error}</div>;
  }
  const d = output?.data;
  if (name === "request_purchase" && d?.purchase_id) {
    const key = d.status === "approved" ? "captured" : (d.status as string);
    const s = PURCHASE_STATUS[key] ?? { label: d.status, className: "" };
    return (
      <Link href={`/purchases/${d.purchase_id}`} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-muted/50">
        <span className="min-w-0 truncate">
          {((d.items as { name: string }[] | undefined) ?? []).map((i) => i.name).join(", ")}
          <span className="text-muted-foreground"> · ${d.total}</span>
        </span>
        <Badge className={s.className}>{s.label}</Badge>
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span aria-hidden>✓</span>
      {label}
    </div>
  );
}

function friendlyError(msg: string) {
  if (/an error occurred|rate|quota|429|overloaded/i.test(msg)) {
    return "The free AI models are busy right now. Anything already bought is on your dashboard. Try again in a minute.";
  }
  try {
    const j = JSON.parse(msg);
    return j.message ?? "The agent hit an error. Try again.";
  } catch {
    return msg.length < 200 ? msg : "The agent hit an error. Try again.";
  }
}
