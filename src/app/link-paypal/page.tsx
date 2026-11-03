import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignOutButton, SiteHeader } from "@/components/app/site-header";
import { getSessionUserId } from "@/lib/session";
import { getActiveVault } from "@/lib/users";
import { LinkPayPal } from "./link-paypal";

export const metadata = { title: "Link PayPal · Allowance" };

export default function Page() {
  return (
    <>
      <SiteHeader>
        <SignOutButton />
      </SiteHeader>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-16">
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Step 2 of 3</p>
          <h1 className="text-2xl font-semibold tracking-tight">Link PayPal once</h1>
          <p className="text-sm text-muted-foreground">
            Approve once with your PayPal account (use the <strong>sandbox personal</strong> test account). Allowance
            stores a PayPal payment token on the server; your agents never see it, and they can only spend within your
            rules.
          </p>
        </div>
        <Suspense fallback={<div className="h-32 animate-pulse rounded-xl border bg-muted/40" />}>
          <VaultState />
        </Suspense>
      </main>
    </>
  );
}

async function VaultState() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const vault = await getActiveVault(userId);
  return (
    <>
      {vault && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          ✓ PayPal is linked ({vault.payerEmail}). You can link a different account below, or{" "}
          <Link href="/dashboard" className="font-medium underline">
            go to your dashboard
          </Link>
          .
        </p>
      )}
      <LinkPayPal />
    </>
  );
}
