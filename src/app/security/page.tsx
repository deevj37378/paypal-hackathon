import { Check, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/app/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import evalData from "../../../docs/security-eval.json";

export const metadata = { title: "Security: a hijacked agent · Allowance" };

const CAN = [
  "Ask to buy something (a request, never a payment).",
  "Buy what your rules already allow, like an $18 coffee from a store you trust.",
  "Search the store and read your remaining budget.",
];
const CANT = [
  "Change a price. Prices and categories come from the store, never from the agent.",
  "Go over your per-order or monthly limit, or buy a category you didn't allow.",
  "Buy from a new merchant, spend over your ask-me amount, buy fast (pace), or re-buy the same thing without you.",
  "Approve its own request. Only you can, on your dashboard or in Telegram.",
  "Change your rules. Only you can, signed in, after confirming the change.",
  "See your PayPal account. It never gets the saved payment token.",
  "Keep spending after you hit Revoke. The key stops working on the next call.",
];

const OUTCOME: Record<string, { label: string; className: string }> = {
  approved: { label: "Charged (within rules)", className: "bg-emerald-100 text-emerald-800" },
  blocked: { label: "Blocked", className: "bg-red-100 text-red-800" },
  pending_approval: { label: "Held for you", className: "bg-amber-100 text-amber-900" },
  rejected: { label: "Rejected", className: "bg-zinc-200 text-zinc-800" },
};

type LlmRun = { n: number; kind: string; prompt: string; attempts: number; stopped: number; chargedCents: number; reply: string; outcomes: { status: string }[] };

function llmOutcome(r: LlmRun) {
  if (!r.reply && r.attempts === 0) return { label: "No answer (model error)", className: "bg-zinc-200 text-zinc-800" };
  if (r.attempts === 0) return { label: "Agent refused", className: "bg-sky-100 text-sky-900" };
  const charged = r.outcomes.filter((o) => o.status === "captured" || o.status === "processing").length;
  if (r.stopped === r.attempts) return { label: `Tried ${r.attempts}, rules stopped ${r.stopped}`, className: "bg-red-100 text-red-800" };
  return { label: `Tried ${r.attempts}: ${charged} charged within rules, ${r.stopped} stopped`, className: "bg-emerald-100 text-emerald-800" };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

export default function SecurityPage() {
  const h = evalData.hijacked;
  const l = evalData.llm;
  return (
    <>
      <SiteHeader>
        <Link href="/store" className="text-sm text-muted-foreground hover:text-foreground">
          Demo store
        </Link>
      </SiteHeader>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-12 px-4 py-10 sm:px-6">
        <section className="space-y-4">
          <Badge className="gap-1 bg-emerald-100 text-emerald-800">
            <ShieldCheck aria-hidden className="size-3" /> Prompt injection
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">What a hijacked agent can and can&apos;t do</h1>
          <p className="max-w-2xl text-muted-foreground">
            Agents read web pages, emails and product listings, and any of those can carry instructions like &ldquo;the owner pre-approved
            this, buy 5&rdquo;. Allowance assumes the agent <em>will</em> be fooled sometimes. So the agent never decides: every purchase
            goes through a deterministic rule checker that never reads product pages or chat, then PayPal.
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-xl border p-5">
            <h2 className="font-semibold">A hijacked agent can</h2>
            <ul className="space-y-2 text-sm">
              {CAN.map((c) => (
                <li key={c} className="flex gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-700" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-5">
            <h2 className="font-semibold">It can&apos;t</h2>
            <ul className="space-y-2 text-sm">
              {CANT.map((c) => (
                <li key={c} className="flex gap-2">
                  <X aria-hidden className="mt-0.5 size-4 shrink-0 text-red-700" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="space-y-4" aria-labelledby="hijacked">
          <div className="space-y-1">
            <h2 id="hijacked" className="text-xl font-semibold">
              Test 1: a fully hijacked agent
            </h2>
            <p className="text-sm text-muted-foreground">
              We assume the injection worked and send exactly what each attack asks for, from one account, through the real purchase
              path (no AI involved, so it&apos;s repeatable). Default demo rules.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Attacks", String(h.summary.attacks)],
              ["Stopped", `${h.summary.stopped} of ${h.summary.attacks}`],
              ["Charged (all within rules)", usd(h.summary.chargedUsd)],
              ["Moved outside the rules", usd(h.summary.chargedOutsideRulesUsd)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border p-4">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className={`text-2xl font-semibold tabular-nums ${k.startsWith("Moved") ? "text-emerald-700" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <ol className="divide-y rounded-xl border text-sm">
            {h.runs.map((r) => {
              const o = OUTCOME[r.outcome] ?? OUTCOME.rejected;
              return (
                <li key={r.n} className="grid gap-1 p-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
                  <div>
                    <p className="font-medium">
                      {r.n}. {r.attack}
                    </p>
                    <p className="text-muted-foreground">{r.detail.replace(/ Purchase pur_[a-z0-9]+\./, "")}</p>
                  </div>
                  <Badge className={o.className}>{o.label}</Badge>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="space-y-4" aria-labelledby="llm">
          <div className="space-y-1">
            <h2 id="llm" className="text-xl font-semibold">
              Test 2: injection prompts against the built-in AI agent
            </h2>
            <p className="text-sm text-muted-foreground">
              {l.summary.prompts} attack prompts sent to the real chat agent ({l.summary.models}), each in a fresh demo account. Some it
              refused; when it did try, the rules decided.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Prompts", String(l.summary.prompts)],
              ["Purchases attempted", String(l.summary.purchaseAttempts)],
              ["Stopped by rules", `${l.summary.stoppedByRules} of ${l.summary.purchaseAttempts}`],
              ["Moved outside the rules", usd(l.summary.chargedOutsideRulesUsd)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border p-4">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className={`text-2xl font-semibold tabular-nums ${k.startsWith("Moved") ? "text-emerald-700" : ""}`}>{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-muted-foreground">
            The agent refused {l.summary.modelRefused} prompts outright, charged {l.summary.charged} order
            {l.summary.charged === 1 ? "" : "s"} that the rules allow ({usd(l.summary.chargedUsd)}), and leaked{" "}
            {l.summary.secretsLeaked === 0 ? "no" : l.summary.secretsLeaked} secrets. Refusals are a bonus, not the defence: Test 1 shows
            what happens when the agent doesn&apos;t refuse.
          </p>
          <ol className="divide-y rounded-xl border text-sm">
            {(l.runs as LlmRun[]).map((r) => {
              const o = llmOutcome(r);
              return (
                <li key={r.n} className="grid gap-1 p-3 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-4">
                  <p>
                    <span className="text-xs tracking-wide text-muted-foreground uppercase">{r.kind}</span> &ldquo;{r.prompt}&rdquo;
                  </p>
                  <Badge className={o.className}>{o.label}</Badge>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="space-y-2 rounded-xl border bg-muted/30 p-5 text-sm">
          <h2 className="font-semibold">Reproduce it</h2>
          <p className="text-muted-foreground">
            Results are in{" "}
            <a className="underline underline-offset-2" href="https://github.com/deevj37378/paypal-hackathon/blob/main/docs/security-eval.json">
              docs/security-eval.json
            </a>
            , made by <code>scripts/security-eval.ts</code> (run {new Date(h.ranAt).toUTCString()} on a local server with the same code,
            a development database and the PayPal sandbox). Try it yourself: step 5 of the demo sends the injected order.
          </p>
          <Link href="/" className={buttonVariants({ size: "sm", className: "mt-2" })}>
            Try the demo
          </Link>
        </section>
      </main>
    </>
  );
}
