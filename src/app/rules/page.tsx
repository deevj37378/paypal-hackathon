import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/app/app-shell";
import { db, schema } from "@/db";
import { aiConfigured } from "@/lib/ai/model";
import { ruleCards } from "@/lib/policy/describe";
import { getSessionUserId } from "@/lib/session";
import { getActivePolicy } from "@/lib/users";
import { signingConfigured } from "@/lib/mandates/keys";
import { grantState, listGrants } from "@/lib/allowances";
import { STORE_MERCHANTS } from "@/lib/store/catalog";
import { OneTimeAllowances } from "./one-time";
import { RulesEditor } from "./rules-editor";

export const metadata = { title: "Rules · Allowance" };

export default function Page() {
  return (
    <AppShell active="rules">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Spending rules
        </h1>
        <p className="text-sm text-muted-foreground">
          Write rules the way you&apos;d say them. AI turns them into settings;
          you confirm before anything changes. Every purchase is then checked
          against these settings by deterministic code, never by AI.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="h-96 animate-pulse rounded-xl border bg-muted/40" />
        }
      >
        <RulesContent />
      </Suspense>
    </AppShell>
  );
}

async function RulesContent() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const [policy, cats, merchants, grants] = await Promise.all([
    getActivePolicy(userId),
    db().selectDistinct({ c: schema.products.category }).from(schema.products),
    db()
      .select({ id: schema.merchants.id, name: schema.merchants.name })
      .from(schema.merchants),
    listGrants(userId),
  ]);
  const categories = cats
    .map((c) => c.c)
    .filter((c) => c !== "test")
    .sort();
  const storeMerchants = merchants.filter((m) =>
    STORE_MERCHANTS.includes(m.id),
  );
  const names = Object.fromEntries(merchants.map((m) => [m.id, m.name]));
  return (
    <div className="space-y-6">
      <RulesEditor
        current={policy?.rules ?? null}
        currentCards={policy ? ruleCards(policy.rules, names) : []}
        merchantNames={names}
        sourceText={policy?.sourceText ?? ""}
        aiAvailable={aiConfigured()}
        signing={signingConfigured()}
        categories={categories}
      />
      <OneTimeAllowances
        grants={grants.map((g) => ({
          id: g.id,
          description: g.description,
          amountCents: g.amountCents,
          category: g.category,
          merchantId: g.merchantId,
          expiresAt: g.expiresAt.toISOString(),
          state: grantState(g),
          usedPurchaseId: g.usedPurchaseId,
        }))}
        categories={categories}
        merchants={storeMerchants}
        aiAvailable={aiConfigured()}
        signing={signingConfigured()}
      />
    </div>
  );
}
