"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Keeps the dashboard live: settles due payouts, then re-renders server data. */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      await fetch("/api/payouts/tick", { method: "POST" }).catch(() => {});
      if (!stopped) router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [router, intervalMs]);
  return null;
}
