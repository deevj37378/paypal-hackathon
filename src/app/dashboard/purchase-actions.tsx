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

export function RefundButton({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (!confirm("Refund this purchase to your PayPal?")) return;
            setError(null);
            try {
              await post(`/api/purchases/${purchaseId}/refund`);
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          })
        }
      >
        {pending ? "Refunding…" : "Refund"}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
