"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { diffRules, type RuleCard } from "@/lib/policy/describe";
import type { PolicyRules } from "@/lib/policy/schema";

type Proposal = { rules: PolicyRules; assumptions: string[]; source: "ai" | "form" };
type Card2 = RuleCard & { before: string | null; changed: boolean };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data as T;
}

export function RulesEditor(props: {
  current: PolicyRules | null;
  currentCards: RuleCard[];
  sourceText: string;
  aiAvailable: boolean;
  categories: string[];
}) {
  const router = useRouter();
  const [text, setText] = useState(props.sourceText);
  const [question, setQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [showForm, setShowForm] = useState(!props.aiAvailable);

  const current = props.current;
  const cards: Card2[] = useMemo(() => (proposal ? diffRules(current, proposal.rules) : []), [proposal, current]);

  const translate = (input: string) =>
    start(async () => {
      setError(null);
      setSaved(false);
      setQuestion(null);
      setProposal(null);
      try {
        const r = await post<{ kind: string; rules?: PolicyRules; assumptions?: string[]; question?: string; message?: string }>(
          "/api/policy/compile",
          { text: input },
        );
        if (r.kind === "rules" && r.rules) setProposal({ rules: r.rules, assumptions: r.assumptions ?? [], source: "ai" });
        else if (r.kind === "clarify") setQuestion(r.question ?? "Could you clarify?");
        else setError(r.message ?? "Couldn't translate those rules.");
      } catch (e) {
        setError((e as Error).message);
      }
    });

  const activate = () =>
    start(async () => {
      if (!proposal) return;
      setError(null);
      try {
        await post("/api/policy", { rules: proposal.rules, sourceText: proposal.source === "ai" ? text : null });
        setProposal(null);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Describe your rules</CardTitle>
          <CardDescription>
            For example: &ldquo;$150 a month, only coffee and books, max $40 per order, ask me before anything over $25.&rdquo;
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="rules-text" className="sr-only">
            Rules in plain English
          </Label>
          <textarea
            id="rules-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={5}
            className="w-full resize-y rounded-lg border bg-background p-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => translate(text)} disabled={pending || !props.aiAvailable || text.trim().length < 5}>
              {pending && !proposal ? "Translating…" : "Translate with AI"}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Hide form" : "Edit with a form"}
            </Button>
          </div>
          {!props.aiAvailable && <p className="text-sm text-muted-foreground">AI translation is unavailable right now. Use the form; it works the same way.</p>}

          {question && (
            <form
              className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const next = `${text.trim()}\n${answer.trim()}`;
                setText(next);
                setAnswer("");
                translate(next);
              }}
            >
              <p className="font-medium text-sky-900">{question}</p>
              <Label htmlFor="clarify" className="sr-only">
                Your answer
              </Label>
              <div className="flex gap-2">
                <Input id="clarify" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" required />
                <Button type="submit" disabled={pending}>
                  Answer
                </Button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="text-sm text-emerald-700">
              ✓ New rules are active. Every purchase from now on is checked against them.
            </p>
          )}
          {showForm && (
            <ManualForm
              initial={proposal?.rules ?? props.current}
              categories={props.categories}
              onPropose={(rules) => {
                setQuestion(null);
                setProposal({ rules, assumptions: [], source: "form" });
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{proposal ? "Review before activating" : "Active rules"}</CardTitle>
          <CardDescription>
            {proposal ? "Changes are highlighted. Nothing changes until you activate." : "What your agents can do right now."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {(proposal ? cards : props.currentCards.map((c) => ({ ...c, before: null, changed: false }))).map((c) => (
              <li key={c.id} className={`rounded-lg border p-3 text-sm ${c.changed ? "border-sky-300 bg-sky-50/70" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{c.title}</span>
                  {c.changed && <Badge className="bg-sky-100 text-sky-800">{c.before ? "Changed" : "New"}</Badge>}
                </div>
                <p className="mt-1 font-medium">{c.value}</p>
                {c.changed && c.before && <p className="text-xs text-muted-foreground line-through">{c.before}</p>}
              </li>
            ))}
            {!proposal && props.currentCards.length === 0 && <li className="text-sm text-muted-foreground">No active rules yet.</li>}
          </ul>
          {proposal && proposal.assumptions.length > 0 && (
            <div className="rounded-lg bg-muted/60 p-3 text-sm">
              <p className="font-medium">Assumptions</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                {proposal.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {proposal && (
            <div className="flex gap-2">
              <Button onClick={activate} disabled={pending}>
                {pending ? "Activating…" : "Activate these rules"}
              </Button>
              <Button variant="outline" onClick={() => setProposal(null)} disabled={pending}>
                Discard
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ManualForm({
  initial,
  categories,
  onPropose,
}: {
  initial: PolicyRules | null;
  categories: string[];
  onPropose: (r: PolicyRules) => void;
}) {
  const usd = (c: number | null | undefined) => (c == null ? "" : String(c / 100));
  const [monthly, setMonthly] = useState(usd(initial?.monthlyLimitCents ?? 15000));
  const [perOrder, setPerOrder] = useState(usd(initial?.perOrderLimitCents));
  const [approval, setApproval] = useState(usd(initial?.approvalThresholdCents));
  const [allowed, setAllowed] = useState<string[]>(initial?.allowedCategories ?? []);
  const [askNew, setAskNew] = useState(initial?.requireApprovalForNewMerchants ?? true);
  const [err, setErr] = useState<string | null>(null);
  const cents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s) * 100));

  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const m = cents(monthly);
        if (!m || m <= 0) return setErr("Set a monthly limit above $0.");
        const p = cents(perOrder);
        if (p !== null && p > m) return setErr("The per-order limit can't exceed the monthly limit.");
        setErr(null);
        onPropose({
          version: 1,
          currency: "USD",
          monthlyLimitCents: m,
          perOrderLimitCents: p,
          approvalThresholdCents: cents(approval),
          allowedCategories: allowed,
          blockedCategories: initial?.blockedCategories ?? [],
          blockedMerchants: initial?.blockedMerchants ?? [],
          trustedMerchants: initial?.trustedMerchants ?? ["demo-store"],
          requireApprovalForNewMerchants: askNew,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["m", "Monthly limit ($)", monthly, setMonthly, true],
          ["p", "Max per order ($)", perOrder, setPerOrder, false],
          ["a", "Ask me above ($)", approval, setApproval, false],
        ].map(([id, label, v, set, req]) => (
          <div key={id as string} className="space-y-1">
            <Label htmlFor={`f-${id}`}>{label as string}</Label>
            <Input
              id={`f-${id}`}
              inputMode="decimal"
              type="number"
              min="0"
              step="0.01"
              value={v as string}
              required={req as boolean}
              placeholder={req ? "" : "none"}
              onChange={(e) => (set as (s: string) => void)(e.target.value)}
            />
          </div>
        ))}
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Only these categories (none = any)</legend>
        <div className="flex flex-wrap gap-3">
          {categories.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={allowed.includes(c)}
                onChange={(e) => setAllowed((xs) => (e.target.checked ? [...xs, c] : xs.filter((x) => x !== c)))}
              />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-primary" checked={askNew} onChange={(e) => setAskNew(e.target.checked)} />
        Ask before buying from a new merchant
      </label>
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <Button type="submit" variant="secondary">
        Preview changes
      </Button>
    </form>
  );
}
