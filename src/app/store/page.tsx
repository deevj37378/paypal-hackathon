import { BookOpen, Coffee, CupSoda, Headphones, Package, Sparkles } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteHeader } from "@/components/app/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatUsd } from "@/lib/money";
import { getCatalog } from "@/lib/store/catalog";

export const metadata = { title: "Bean & Page · an agent-ready store" };

const ICON: Record<string, typeof Coffee> = { coffee: Coffee, books: BookOpen, kitchen: CupSoda, electronics: Headphones };
const TINT: Record<string, string> = {
  coffee: "from-amber-100 to-orange-50 text-amber-800",
  books: "from-sky-100 to-indigo-50 text-indigo-800",
  kitchen: "from-rose-100 to-pink-50 text-rose-800",
  electronics: "from-zinc-200 to-zinc-50 text-zinc-800",
};

export default function StorePage() {
  return (
    <>
      <SiteHeader>
        <Link href="/store/merchant" className="text-sm text-muted-foreground hover:text-foreground">
          Merchant view
        </Link>
      </SiteHeader>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-10 px-4 py-10 sm:px-6">
        <section className="flex flex-col gap-6 rounded-2xl border bg-gradient-to-br from-amber-50 via-background to-sky-50 p-6 sm:flex-row sm:items-end sm:justify-between sm:p-10">
          <div className="space-y-3">
            <Badge className="gap-1 bg-emerald-100 text-emerald-800">
              <Sparkles aria-hidden className="size-3" /> Agent-ready
            </Badge>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Bean &amp; Page</h1>
            <p className="max-w-xl text-muted-foreground">
              Coffee and books. A demo shop where AI agents can browse and buy, paid with the owner&apos;s PayPal through Allowance,
              and only within the owner&apos;s rules.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/api/store/products" className={buttonVariants({ variant: "outline" })}>
              JSON product feed
            </Link>
            <Link href="/" className={buttonVariants()}>
              Let an agent shop
            </Link>
          </div>
        </section>
        <Suspense fallback={<div className="h-96 animate-pulse rounded-xl border bg-muted/40" />}>
          <Products />
        </Suspense>
      </main>
    </>
  );
}

async function Products() {
  await connection();
  const rows = await getCatalog();
  const groups = ["demo-store", "gadget-hub"].map((m) => ({ id: m, name: rows.find((r) => r.p.merchantId === m)?.merchantName ?? m, items: rows.filter((r) => r.p.merchantId === m) }));
  return (
    <>
      {groups.map((g) => (
        <section key={g.id} className="space-y-4" aria-labelledby={`m-${g.id}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 id={`m-${g.id}`} className="text-lg font-semibold">
              {g.name}
            </h2>
            <p className="font-mono text-xs text-muted-foreground">merchant_id: {g.id}</p>
          </div>
          {g.id === "gadget-hub" && (
            <p className="-mt-2 text-sm text-muted-foreground">A second shop. Under the default rules it counts as a new merchant, so the owner is asked first.</p>
          )}
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {g.items.map(({ p }) => {
              const Icon = ICON[p.category] ?? Package;
              return (
                <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
                  <div className={`grid aspect-[4/3] place-items-center bg-gradient-to-br ${TINT[p.category] ?? "from-muted to-background"}`}>
                    <Icon aria-hidden className="size-10 opacity-80" strokeWidth={1.5} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-4">
                    <p className="text-xs tracking-wide text-muted-foreground uppercase">{p.category}</p>
                    <p className="font-medium leading-snug">{p.name}</p>
                    <p className="text-sm text-muted-foreground">{p.description}</p>
                    <div className="mt-auto flex items-end justify-between pt-3">
                      <span className="text-lg font-semibold tabular-nums">{formatUsd(p.priceCents)}</span>
                      <code className="text-[11px] text-muted-foreground">{p.id}</code>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
