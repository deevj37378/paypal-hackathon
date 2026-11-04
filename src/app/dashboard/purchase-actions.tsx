"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data;
}

export function ApprovalButtons({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const decide = (approve: boolean) =>
    start(async () => {
      setError(null);
      try {
        await post(`/api/purchases/${purchaseId}/decision`, { approve });
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button variant="outline" disabled={pending} onClick={() => decide(false)}>
          Decline
        </Button>
        <Button disabled={pending} onClick={() => decide(true)}>
          {pending ? "Working…" : "Approve"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function RefundButton({ purchaseId, amount }: { purchaseId: string; amount?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refund = () =>
    start(async () => {
      setError(null);
      try {
        await post(`/api/purchases/${purchaseId}/refund`);
        setConfirming(false);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div role="group" aria-label="Confirm refund" className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Refund{amount ? ` ${amount}` : ""}?</span>
          <Button size="sm" variant="destructive" disabled={pending} onClick={refund}>
            {pending ? "Refunding…" : "Yes, refund"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          Refund
        </Button>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
