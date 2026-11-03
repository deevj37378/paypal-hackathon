"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function TelegramCard({ connected, username, enabled }: { connected: boolean; username: string | null; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  const connect = () =>
    start(async () => {
      setError(null);
      // Open the tab synchronously (popup blockers), then point it at the one-time link.
      const tab = window.open("", "_blank");
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        tab?.close();
        return setError(data.message ?? "Couldn't create a Telegram link.");
      }
      if (tab) tab.location.href = data.url;
      else window.location.href = data.url;
      setOpened(true);
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
      <CardContent className="space-y-2 text-sm">
        {!enabled ? (
          <p className="text-muted-foreground">Telegram isn&apos;t configured on this server. Approve purchases here instead.</p>
        ) : connected ? (
          <>
            <p className="text-muted-foreground">Held purchases arrive with Approve / Decline buttons.</p>
            <Button variant="ghost" size="sm" onClick={disconnect} disabled={pending}>
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">Get Approve / Decline buttons in Telegram when an agent needs your OK.</p>
            <Button size="sm" onClick={connect} disabled={pending}>
              Connect Telegram
            </Button>
            {opened && (
              <p className="text-muted-foreground">
                Press <strong>Start</strong> in Telegram, then{" "}
                <button className="underline" onClick={() => router.refresh()}>
                  refresh
                </button>
                .
              </p>
            )}
          </>
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
