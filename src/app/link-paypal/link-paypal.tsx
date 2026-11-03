"use client";

import Link from "next/link";
import Script from "next/script";
import { useCallback, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "ineligible" }
  | { kind: "working"; message: string }
  | { kind: "saved"; payerEmail: string | null }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

type SaveSession = { start(opts: Record<string, unknown>, setupToken: Promise<unknown>): Promise<void> };
type PayPalSdk = {
  createInstance(opts: Record<string, unknown>): Promise<{
    findEligibleMethods(opts: Record<string, unknown>): Promise<{ isEligible(m: string): boolean }>;
    createPayPalSavePaymentSession(opts: Record<string, unknown>): SaveSession;
  }>;
};

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** PayPal JS SDK v6 "save PayPal without purchase". https://developer.paypal.com/sdk/save-without-purchase/paypal */
export function LinkPayPal() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const sessionRef = useRef<SaveSession | null>(null);

  const init = useCallback(async () => {
    try {
      const paypal = (window as unknown as { paypal: PayPalSdk }).paypal;
      const { accessToken } = await json<{ accessToken: string }>(await fetch("/api/paypal/client-token"));
      const sdk = await paypal.createInstance({ clientToken: accessToken, components: ["paypal-payments"], pageType: "checkout" });
      const methods = await sdk.findEligibleMethods({ currencyCode: "USD", paymentFlow: "VAULT_WITHOUT_PAYMENT" });
      if (!methods.isEligible("paypal")) return setStatus({ kind: "ineligible" });
      sessionRef.current = sdk.createPayPalSavePaymentSession({
        async onApprove(data: { vaultSetupToken: string }) {
          setStatus({ kind: "working", message: "Saving your PayPal…" });
          try {
            const saved = await json<{ payerEmail: string | null }>(
              await fetch("/api/paypal/payment-token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vaultSetupToken: data.vaultSetupToken }),
              }),
            );
            setStatus({ kind: "saved", payerEmail: saved.payerEmail });
          } catch (e) {
            setStatus({ kind: "error", message: (e as Error).message });
          }
        },
        onCancel: () => setStatus({ kind: "cancelled" }),
        onError: (err: unknown) => setStatus({ kind: "error", message: String(err) }),
      });
      setStatus({ kind: "ready" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }, []);

  const onClick = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    // Don't await before start(): the popup needs the click's transient activation.
    const setupToken = fetch("/api/paypal/setup-token", { method: "POST" })
      .then((r) => json<{ id: string }>(r))
      .then(({ id }) => ({ vaultSetupToken: id, setupToken: id }));
    try {
      await session.start({ presentationMode: "auto" }, setupToken);
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  }, []);

  const showButton = status.kind === "ready" || status.kind === "cancelled" || status.kind === "error";

  return (
    <div className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
      <Script src="https://www.sandbox.paypal.com/web-sdk/v6/core" strategy="afterInteractive" onReady={() => void init()} />
      {status.kind !== "saved" && <paypal-button type="pay" hidden={!showButton} onClick={onClick} />}
      <div role="status" aria-live="polite" className="text-sm">
        {status.kind === "loading" && <p className="text-muted-foreground">Loading PayPal…</p>}
        {status.kind === "ineligible" && (
          <p className="text-destructive">Saving PayPal isn&apos;t available for this app. Check that Vault is enabled.</p>
        )}
        {status.kind === "working" && <p className="text-muted-foreground">{status.message}</p>}
        {status.kind === "cancelled" && <p className="text-muted-foreground">Cancelled. Nothing was saved.</p>}
        {status.kind === "error" && <p className="text-destructive">Couldn&apos;t link PayPal: {status.message}</p>}
        {status.kind === "saved" && (
          <div className="space-y-3">
            <p className="text-emerald-700">✓ PayPal linked{status.payerEmail ? ` (${status.payerEmail})` : ""}.</p>
            <Link href="/dashboard" className={buttonVariants()}>
              Continue to dashboard
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
