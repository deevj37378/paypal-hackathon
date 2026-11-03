"use client";

import Script from "next/script";
import { useCallback, useRef, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "ineligible" }
  | { kind: "working"; message: string }
  | { kind: "saved"; payerEmail: string | null; customerId: string | null }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type PayPalSdk = {
  createInstance(opts: Record<string, unknown>): Promise<{
    findEligibleMethods(opts: Record<string, unknown>): Promise<{ isEligible(m: string): boolean }>;
    createPayPalSavePaymentSession(opts: Record<string, unknown>): {
      start(opts: Record<string, unknown>, setupToken: Promise<unknown>): Promise<void>;
    };
  }>;
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function VaultSpike() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const sessionRef = useRef<ReturnType<
    Awaited<ReturnType<PayPalSdk["createInstance"]>>["createPayPalSavePaymentSession"]
  > | null>(null);

  const init = useCallback(async () => {
    try {
      const paypal = (window as unknown as { paypal: PayPalSdk }).paypal;
      const { accessToken } = await json<{ accessToken: string }>(await fetch("/api/paypal/client-token"));
      const sdk = await paypal.createInstance({
        clientToken: accessToken,
        components: ["paypal-payments"],
        pageType: "checkout",
      });
      const methods = await sdk.findEligibleMethods({
        currencyCode: "USD",
        paymentFlow: "VAULT_WITHOUT_PAYMENT",
      });
      if (!methods.isEligible("paypal")) {
        setStatus({ kind: "ineligible" });
        return;
      }
      sessionRef.current = sdk.createPayPalSavePaymentSession({
        async onApprove(data: { vaultSetupToken: string }) {
          setStatus({ kind: "working", message: "Saving your PayPal…" });
          try {
            const saved = await json<{ payerEmail: string | null; customerId: string | null }>(
              await fetch("/api/paypal/payment-token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vaultSetupToken: data.vaultSetupToken }),
              }),
            );
            setStatus({ kind: "saved", ...saved });
          } catch (e) {
            setStatus({ kind: "error", message: (e as Error).message });
          }
        },
        onCancel() {
          setStatus({ kind: "cancelled" });
        },
        onError(err: unknown) {
          setStatus({ kind: "error", message: String(err) });
        },
      });
      setStatus({ kind: "ready" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }, []);

  const onClick = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    // Don't await before start(): popups need the click's transient activation.
    const setupToken = fetch("/api/paypal/setup-token", { method: "POST" })
      .then((r) => json<{ id: string }>(r))
      .then(({ id }) => ({ vaultSetupToken: id, setupToken: id }));
    try {
      await session.start({ presentationMode: "auto" }, setupToken);
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }, []);

  return (
    <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <Script src="https://www.sandbox.paypal.com/web-sdk/v6/core" strategy="afterInteractive" onReady={() => void init()} />

      <paypal-button
        type="pay"
        hidden={!(status.kind === "ready" || status.kind === "cancelled" || status.kind === "error")}
        onClick={onClick}
      />

      <p role="status" aria-live="polite" className="text-sm">
        {status.kind === "loading" && <span className="text-muted-foreground">Loading PayPal…</span>}
        {status.kind === "ready" && <span className="text-muted-foreground">Ready.</span>}
        {status.kind === "ineligible" && (
          <span className="text-destructive">
            PayPal save-payment isn&apos;t eligible for this app. Check that Vault is enabled in the sandbox app.
          </span>
        )}
        {status.kind === "working" && <span className="text-muted-foreground">{status.message}</span>}
        {status.kind === "cancelled" && <span className="text-muted-foreground">Cancelled. Nothing was saved.</span>}
        {status.kind === "error" && <span className="text-destructive">Error: {status.message}</span>}
        {status.kind === "saved" && (
          <span className="text-emerald-700">
            ✓ PayPal linked{status.payerEmail ? ` (${status.payerEmail})` : ""}. Now run{" "}
            <code className="rounded bg-muted px-1">npm run spike:charge</code>.
          </span>
        )}
      </p>
    </div>
  );
}
