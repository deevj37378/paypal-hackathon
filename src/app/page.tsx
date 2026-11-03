import { SiteHeader } from "@/components/app/site-header";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-20">
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Spending limits for AI agents, enforced by PayPal.</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">
            Give any AI agent a limited, revocable PayPal spending permission. Write the rules, link PayPal once, and
            every purchase is checked by a deterministic rule engine. The AI never makes the final money decision.
          </p>
        </div>
        <ol className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            ["1. Set rules", "$150/month, only coffee and books, ask me over $25."],
            ["2. Link PayPal", "One approval. Your agent never sees your account."],
            ["3. Connect an agent", "Approved, held for your OK, or blocked with a reason."],
          ].map(([t, d]) => (
            <li key={t} className="rounded-xl border bg-card p-4">
              <p className="font-medium">{t}</p>
              <p className="mt-1 text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <form action="/api/demo" method="post">
            <button className={buttonVariants({ size: "lg" })}>Try the demo</button>
          </form>
          <form action="/api/session" method="post">
            <button className={buttonVariants({ size: "lg", variant: "outline" })}>Start with my own PayPal</button>
          </form>
          <a href="/store" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
            Visit the agent-ready store
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          Demo: no sign-up and no PayPal login. It uses a sandbox test buyer, nothing real is charged, and it expires in 24 hours.
        </p>
      </main>
    </>
  );
}
