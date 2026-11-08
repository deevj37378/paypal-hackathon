"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyField } from "./agents-panel";

type Link = { url: string; appUrl: string; code: string; bot: string };

const POLL_MS = 4000;
const CODE_LIFETIME_MS = 15 * 60 * 1000;

/** Telegram Web opens the bot chat in the browser, so connecting works on a laptop without the Telegram app. */
const telegramWebUrl = (link: Link) => `https://web.telegram.org/k/#?tgaddr=${encodeURIComponent(link.appUrl)}`;

export function TelegramCard({ connected, username, enabled }: { connected: boolean; username: string | null; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<(Link & { expiresAt: number }) | null>(null);

  // One click: open the tab synchronously (so popup blockers allow it), then point it at Telegram Web.
  const connect = async () => {
    if (creating) return;
    setError(null);
    setCreating(true);
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) throw new Error(data.message ?? "Couldn't create a Telegram link.");
      const next = { ...(data as Link), expiresAt: Date.now() + CODE_LIFETIME_MS };
      if (tab) tab.location.href = telegramWebUrl(next);
      setLink(next);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't create a Telegram link.");
    } finally {
      setCreating(false);
    }
  };

  // Notice the connection by itself: refresh every 4 s while waiting, only while this tab is visible, until the code expires.
  useEffect(() => {
    if (!link || connected) return;
    const id = setInterval(() => {
      if (Date.now() > link.expiresAt) return clearInterval(id);
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [link, connected, router]);

  const disconnect = () =>
    start(async () => {
      await fetch("/api/telegram/disconnect", { method: "POST" });
      setLink(null);
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
            <p>
              Telegram opened in a new tab. Press <strong>Start</strong> there (sign in with the QR code if Telegram asks).
            </p>
            <p className="text-muted-foreground">
              Didn&apos;t open?{" "}
              <a href={telegramWebUrl(link)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                Open Telegram
              </a>
            </p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Prefer the app? Open <strong>@{link.bot}</strong> and send this (works once, for 15 minutes):
              </p>
              <CopyField value={`/start ${link.code}`} label="Telegram start command" />
            </div>
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
