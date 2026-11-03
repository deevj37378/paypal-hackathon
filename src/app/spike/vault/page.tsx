import { VaultSpike } from "./vault-spike";

export const metadata = { title: "M1 spike: link PayPal · Allowance" };

export default function Page() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-16">
      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          M1 Vault spike · Sandbox
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">Link PayPal once</h1>
        <p className="text-sm text-muted-foreground">
          Log in with the <strong>sandbox personal (buyer)</strong> account and approve. Allowance
          saves a PayPal payment token so later purchases can be charged without you being there,
          but only within your rules.
        </p>
      </div>
      <VaultSpike />
    </main>
  );
}
