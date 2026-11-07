"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyField } from "./agents-panel";

type Link = { url: string; appUrl: string; code: string; bot: string };

export function TelegramCard({ connected, username, enabled }: { connected: boolean; username: string | null; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<Link | null>(null);

  const connect = () =>
    start(async () => {
      setError(null);
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) return setError(data.message ?? "Couldn't create a Telegram link.");
      setLink(data as Link);
    });

  const disconnect = () =>
    start(async () => {
      await fetch("/api/telegram/disconnect", { method: "POST" });
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardDescription>Approvals on your phone</CardDescription>
        <CardTitle className="text-base">{connected ? `Telegram${username ? ` · @${username}` : ""}` : "Telegram not connected"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!enabled ? (
          <p className="text-muted-foreground">Telegram isn&apos;t configured on this server. Approve purchases here instead.</p>
        ) : connected ? (
          <>
            <p className="text-muted-foreground">Held purchases arrive with Approve / Decline buttons.</p>
            <Button variant="ghost" size="sm" onClick={disconnect} disabled={pending}>
              Disconnect
            </Button>
          </>
        ) : !link ? (
          <>
            <p className="text-muted-foreground">Optional: approve held purchases from your phone. You can always approve on this dashboard instead.</p>
            <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
              <li>Click <strong>Connect Telegram</strong>.</li>
              <li>Open the bot and press <strong>Start</strong> (or send the /start code we show you).</li>
              <li>Held purchases then arrive with <strong>Approve</strong> / <strong>Decline</strong> buttons.</li>
            </ol>
            <Button size="sm" onClick={connect} disabled={pending}>
              {pending ? "Creating link…" : "Connect Telegram"}
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground">Use any one of these (the code works once, for 15 minutes):</p>
            <div className="flex flex-wrap gap-2">
              <a href={link.appUrl} className={buttonVariants({ size: "sm" })}>
                Open in Telegram app
              </a>
              <a href={link.url} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}>
                Open t.me link
              </a>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground">
                Or open <strong>@{link.bot}</strong> in Telegram and send:
              </p>
              <CopyField value={`/start ${link.code}`} label="Telegram start command" />
            </div>
            <p className="text-muted-foreground">
              After Telegram says &ldquo;Connected&rdquo;,{" "}
              <button className="underline underline-offset-2" onClick={() => router.refresh()}>
                refresh
              </button>
              .
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
