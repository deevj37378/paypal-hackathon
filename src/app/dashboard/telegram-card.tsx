"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StartCodeFallback, TelegramNextStep, useTelegramConnect } from "@/components/telegram-connect";

export function TelegramCard({ connected, username, enabled }: { connected: boolean; username: string | null; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { connect, creating, error, link, reset } = useTelegramConnect(connected);

  const disconnect = () =>
    start(async () => {
      await fetch("/api/telegram/disconnect", { method: "POST" });
      reset();
      router.refresh();
    });

  return (
    <Card>
      <CardHeader>
        <CardDescription>Approvals in Telegram</CardDescription>
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
            <p className="text-muted-foreground">Optional: approve held purchases in Telegram. You can always approve on this dashboard instead.</p>
            <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
              <li>
                Click <strong>Connect Telegram</strong> (Telegram opens in a new tab).
              </li>
              <li>
                Press <strong>Start</strong>.
              </li>
              <li>
                Held purchases arrive there with <strong>Approve</strong> / <strong>Decline</strong> buttons, on your laptop and your phone.
              </li>
            </ol>
            <Button size="sm" onClick={connect} disabled={creating}>
              {creating ? "Opening Telegram…" : "Connect Telegram"}
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <TelegramNextStep
              link={link}
              opened={
                <>
                  Telegram opened in a new tab. Press <strong>Start</strong> there (sign in with the QR code if Telegram asks).
                </>
              }
              mobileHint={
                <>
                  Then press <strong>Start</strong> in Telegram.
                </>
              }
            />
            <StartCodeFallback link={link} />
            <p className="text-xs text-muted-foreground">
              This card updates by itself once Telegram says &ldquo;Connected&rdquo;. If it doesn&apos;t,{" "}
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
