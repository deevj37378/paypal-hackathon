"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CopyField } from "@/app/dashboard/agents-panel";
import { buttonVariants } from "@/components/ui/button";

/**
 * One connect flow for every "Connect Telegram" entry point.
 * Laptops: a tab opened synchronously in the click (popup-safe) is pointed at Telegram Web.
 * Phones/tablets: we create the code, then the user's own tap on a plain t.me link opens the Telegram app.
 */
export type TelegramLink = { url: string; appUrl: string; code: string; bot: string; expiresAt: number; mobile: boolean };

const POLL_MS = 4000;
const CODE_LIFETIME_MS = 15 * 60 * 1000;

export const telegramWebUrl = (link: Pick<TelegramLink, "appUrl">) =>
  `https://web.telegram.org/k/#?tgaddr=${encodeURIComponent(link.appUrl)}`;

function isPhoneOrTablet() {
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function useTelegramConnect(connected: boolean) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<TelegramLink | null>(null);

  const connect = async () => {
    if (creating) return;
    setError(null);
    setCreating(true);
    const mobile = isPhoneOrTablet();
    const tab = mobile ? null : window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) throw new Error(data.message ?? "Couldn't create a Telegram link.");
      const next: TelegramLink = { ...data, expiresAt: Date.now() + CODE_LIFETIME_MS, mobile };
      if (tab) tab.location.href = telegramWebUrl(next);
      setLink(next);
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "Couldn't create a Telegram link.");
    } finally {
      setCreating(false);
    }
  };

  // Notice the connection by itself: refresh every 4 s while waiting, only while the tab is visible, until the code expires.
  useEffect(() => {
    if (!link || connected) return;
    const id = setInterval(() => {
      if (Date.now() > link.expiresAt) return clearInterval(id);
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [link, connected, router]);

  return { connect, creating, error, link, reset: () => setLink(null) };
}

/** What to show once the code exists: the phone's Open Telegram button, or the laptop's "it opened" line + fallback. */
export function TelegramNextStep({ link, opened, mobileHint }: { link: TelegramLink; opened: React.ReactNode; mobileHint: React.ReactNode }) {
  if (link.mobile) {
    return (
      <div className="space-y-2">
        <a href={link.url} className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })}>
          Open Telegram
        </a>
        <p>{mobileHint}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p>{opened}</p>
      <p className="opacity-80">
        Didn&apos;t open?{" "}
        <a href={telegramWebUrl(link)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
          Open Telegram
        </a>
      </p>
    </div>
  );
}

/** The /start code, small, for people who prefer to type it into the app. */
export function StartCodeFallback({ link }: { link: TelegramLink }) {
  return (
    <div className="space-y-1 text-xs opacity-80">
      <p>
        Prefer the app? Open <strong>@{link.bot}</strong> and send this (works once, for 15 minutes):
      </p>
      <CopyField value={`/start ${link.code}`} label="Telegram start command" />
    </div>
  );
}

/** "Send it to Telegram" at the moment a purchase is held: connecting delivers waiting approvals there. */
export function SendToTelegram() {
  const { connect, creating, error, link } = useTelegramConnect(false);
  if (link) {
    return (
      <div className="space-y-2">
        <TelegramNextStep
          link={link}
          opened={
            <>
              Telegram opened. Press <strong>Start</strong>, and this request arrives there with <strong>Approve</strong> /{" "}
              <strong>Decline</strong>.
            </>
          }
          mobileHint={
            <>
              Then press <strong>Start</strong>, and this request arrives there with <strong>Approve</strong> / <strong>Decline</strong>.
            </>
          }
        />
        <StartCodeFallback link={link} />
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p>
        Or approve it the way an owner would: from Telegram, on your laptop or phone. This request follows you there.
      </p>
      <button type="button" onClick={connect} disabled={creating} className={buttonVariants({ size: "sm" })}>
        {creating ? "Opening Telegram…" : "Send it to Telegram"}
      </button>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
