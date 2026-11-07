import { BookOpen, Bot, Coffee, CupSoda, KeyRound, ListChecks, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

const OUTCOMES = [
  { icon: Coffee, item: "House Blend Coffee", amount: "$18.00", label: "Paid", tone: "bg-emerald-100 text-emerald-800", note: "Within your rules. Charged to your PayPal." },
  { icon: BookOpen, item: "The Pragmatic Programmer", amount: "$32.00", label: "Needs approval", tone: "bg-amber-100 text-amber-900", note: "Over $25, so you get Approve / Decline in Telegram." },
  { icon: CupSoda, item: "Ceramic Mug", amount: "$15.00", label: "Blocked", tone: "bg-red-100 text-red-800", note: "Kitchen isn't an allowed category." },
];

const STEPS = [
  { icon: ListChecks, title: "Write rules in plain English", body: "“$150 a month, only coffee and books, ask me over $25.” Gemini turns it into strict settings you confirm." },
  { icon: Wallet, title: "Link PayPal once", body: "PayPal Vault saves your consent. Agents never see your account or any credential." },
  { icon: Bot, title: "Connect any agent", body: "Claude Desktop over MCP, your own agent over REST, or the built-in assistant. Each gets its own revocable key." },
  { icon: ShieldCheck, title: "Every purchase is checked", body: "Approved and paid, held for your OK, or blocked with a reason. The store is paid out by PayPal Payouts." },
];

const STACK = ["PayPal Vault v3", "Orders v2", "Payouts", "Refunds", "Webhooks", "Catalog Products", "MCP server", "Gemini + Groq", "Telegram"];

export default function Home() {
  return (
    <>
      <SiteHeader wide>
        <Link href="/security" className="text-sm text-muted-foreground hover:text-foreground">
          Security
        </Link>
        <Link href="/store" className="text-sm text-muted-foreground hover:text-foreground">
          Demo store
        </Link>
      </SiteHeader>
      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-16 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
          <div className="space-y-6">
            <Badge className="bg-sky-100 text-sky-900">PayPal AI Hackathon · sandbox demo</Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Spending limits for AI agents, enforced by PayPal.</h1>
            <p className="max-w-xl text-lg text-pretty text-muted-foreground">
              Give any AI agent a limited, revocable PayPal spending permission. You set the rules; a deterministic checker enforces them
              on every purchase. <strong className="font-medium text-foreground">The AI never makes the final money decision.</strong>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <form action="/api/demo" method="post">
                <button className={buttonVariants({ size: "lg" })}>Try the demo</button>
              </form>
              <form action="/api/session" method="post">
                <button className={buttonVariants({ size: "lg", variant: "outline" })}>Start with my own PayPal</button>
              </form>
            </div>
            <p className="text-xs text-muted-foreground">
              No sign-up and no PayPal login: the demo uses a sandbox test buyer, nothing real is charged, and it expires in 24 hours.
            </p>
          </div>

          <div aria-label="Example: what your agent's requests look like" className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Bot aria-hidden className="size-3.5" /> “Restock my coffee and get the book I mentioned.”
              </span>
            </div>
            <ul className="space-y-2.5">
              {OUTCOMES.map((o) => (
                <li key={o.item} className="flex items-start gap-3 rounded-xl border p-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                    <o.icon aria-hidden className="size-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{o.item}</p>
                      <span className="text-sm tabular-nums">{o.amount}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge className={o.tone}>{o.label}</Badge>
                      <span className="text-xs text-muted-foreground">{o.note}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound aria-hidden className="size-3.5" /> Revoke the agent and its next request is refused.
            </p>
          </div>
        </section>

        <section className="border-y bg-card">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-14 md:grid-cols-[1fr_2fr]">
            <h2 className="text-2xl font-semibold tracking-tight">AI agents can shop now. Nothing stops them overspending.</h2>
            <ul className="grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
              <li>
                <p className="font-medium text-foreground">Card-on-file is all or nothing</p>
                Give an agent your payment details and it can spend anything, anywhere.
              </li>
              <li>
                <p className="font-medium text-foreground">Prompts aren&apos;t limits</p>
                &ldquo;Don&apos;t spend more than $40&rdquo; is a suggestion to a model, not an enforced rule.
              </li>
              <li>
                <p className="font-medium text-foreground">No off switch</p>
                When an agent misbehaves you need to cut it off instantly, without cancelling your card.
              </li>
            </ul>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl space-y-8 px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="space-y-2 rounded-xl border bg-card p-5">
                <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <s.icon aria-hidden className="size-4 text-primary" /> Step {i + 1}
                </span>
                <p className="font-medium">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-4 rounded-xl border bg-primary p-6 text-primary-foreground sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">The AI never decides money.</p>
              <p className="text-sm opacity-80">
                Gemini only writes rules you confirm, explains decisions, and powers the demo agent. A unit-tested rule checker makes every call.
              </p>
            </div>
            <form action="/api/demo" method="post">
              <button className={buttonVariants({ variant: "secondary" })}>Try it in 60 seconds</button>
            </form>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 pb-16">
          <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Built with</p>
          <ul className="flex flex-wrap gap-2">
            {STACK.map((s) => (
              <li key={s} className="rounded-full border bg-card px-3 py-1 text-sm">
                {s}
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <p>Allowance runs on the PayPal sandbox. No real money moves.</p>
          <a href="https://github.com/deevj37378/paypal-hackathon" className="underline underline-offset-4 hover:text-foreground">
            Source on GitHub (MIT)
          </a>
        </div>
      </footer>
    </>
  );
}
