"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { grantScope, STATE, usd } from "@/lib/allowance-format";

export type GrantView = {
  id: string;
  description: string;
  amountCents: number;
  category: string | null;
  merchantId: string | null;
  expiresAt: string;
  state: "active" | "used" | "expired" | "cancelled";
  usedPurchaseId: string | null;
};
type Draft = { description: string; amountCents: number; category: string | null; merchantId: string | null; expiresAt: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? "Request failed");
  return data as T;
}

export function OneTimeAllowances(props: { grants: GrantView[]; categories: string[]; merchants: { id: string; name: string }[]; aiAvailable: boolean; signing: boolean }) {
  const router = useRouter();
  const names = Object.fromEntries(props.merchants.map((m) => [m.id, m.name]));
  const [text, setText] = useState("Let my agent buy a birthday gift up to $60 by Friday");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(!props.aiAvailable);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ description: "", amount: "", category: "", merchant: "", date: "" });

  const translate = () =>
    start(async () => {
      setError(null);
      setQuestion(null);
      setDraft(null);
      try {
        const r = await post<{ kind: string; draft?: Draft; question?: string; message?: string }>("/api/allowances/compile", {
          text,
          tzOffset: new Date().getTimezoneOffset(),
        });
        if (r.kind === "draft" && r.draft) setDraft(r.draft);
        else if (r.kind === "clarify") setQuestion(r.question ?? "Could you clarify?");
        else setError(r.message ?? "Couldn't read that.");
      } catch (e) {
        setError((e as Error).message);
      }
    });

  const create = () =>
    start(async () => {
      if (!draft) return;
      setError(null);
      try {
        await post("/api/allowances", draft);
        setDraft(null);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });

  const cancel = (id: string) =>
    start(async () => {
      await post(`/api/allowances/${id}/cancel`, {}).catch(() => {});
      router.refresh();
    });

  return (
    <Card id="one-time" className="scroll-mt-20">
      <CardHeader>
        <CardTitle>One-time allowances</CardTitle>
        <CardDescription>
          Let your agent make one specific purchase your rules wouldn&apos;t normally allow, like a gift. It works once, before the
          deadline. Your monthly limit and blocked stores still apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="grant-text" className="sr-only">
            One-time allowance in plain English
          </Label>
          <Input id="grant-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={translate} disabled={pending || !props.aiAvailable || text.trim().length < 5}>
              {pending && !draft ? "Reading…" : "Set up with AI"}
            </Button>
            <Button variant="ghost" onClick={() => setShowForm((s) => !s)}>
              {showForm ? "Hide form" : "Use a form"}
            </Button>
          </div>
        </div>
        {question && <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">{question} Add it to the sentence and try again.</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {showForm && (
          <form
            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const amountCents = Math.round(Number(form.amount) * 100);
              const [y, m, d] = form.date.split("-").map(Number);
              if (!amountCents || !y) return setError("Set an amount and a date.");
              setError(null);
              setDraft({
                description: form.description.trim() || `${form.category || "a purchase"} up to ${usd(amountCents)}`,
                amountCents,
                category: form.category || null,
                merchantId: form.merchant || null,
                expiresAt: new Date(y, m - 1, d, 23, 59, 59).toISOString(),
              });
            }}
          >
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="g-desc">What for</Label>
              <Input id="g-desc" value={form.description} placeholder="a birthday gift for Sam" onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-amount">Up to ($)</Label>
              <Input id="g-amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-date">Use by (end of day)</Label>
              <Input id="g-date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-cat">Category</Label>
              <select id="g-cat" className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Any category</option>
                {props.categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-merchant">Store</Label>
              <select id="g-merchant" className="h-8 w-full rounded-lg border bg-background px-2 text-sm" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })}>
                <option value="">Any store</option>
                {props.merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="secondary" className="sm:col-span-2 sm:justify-self-start">
              Preview
            </Button>
          </form>
        )}
        {draft && (
          <div className="space-y-3 rounded-lg border border-sky-300 bg-sky-50/70 p-3 text-sm">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Review before creating</p>
            <p className="font-medium">&ldquo;{draft.description}&rdquo;</p>
            <p>
              {grantScope(draft, names)}, until {when(draft.expiresAt)}.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={create} disabled={pending}>
                {pending ? "Creating…" : "Create one-time allowance"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={pending}>
                Discard
              </Button>
            </div>
          </div>
        )}
        {props.grants.length > 0 && (
          <ul className="divide-y rounded-lg border text-sm">
            {props.grants.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-0.5">
                  <p className="font-medium">
                    {g.description} <Badge className={STATE[g.state].className}>{STATE[g.state].label}</Badge>
                  </p>
                  <p className="text-muted-foreground">
                    {grantScope(g, names)} · {g.state === "active" ? `until ${when(g.expiresAt)}` : g.state === "used" ? "used" : `ended ${when(g.expiresAt)}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  {g.usedPurchaseId && (
                    <Link href={`/purchases/${g.usedPurchaseId}`} className="underline underline-offset-2">
                      See purchase
                    </Link>
                  )}
                  {props.signing && (
                    <a href={`/api/mandate?grant=${g.id}`} className="underline underline-offset-2">
                      Signed mandate
                    </a>
                  )}
                  {g.state === "active" && (
                    <Button size="sm" variant="ghost" onClick={() => cancel(g.id)} disabled={pending}>
                      Cancel
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
