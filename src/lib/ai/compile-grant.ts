import { generateText, Output } from "ai";
import { z } from "zod";
import { db, schema } from "@/db";
import { MAX_GRANT_CENTS, MAX_GRANT_DAYS } from "@/lib/allowances";
import { aiQuota } from "./limits";
import { getModel } from "./model";

/**
 * Plain English → a one-time allowance draft ("let my agent buy a birthday gift up to $60 by Friday").
 * The model only proposes; we validate, and the owner confirms before it exists.
 */
const Draft = z.object({
  needsClarification: z.boolean().describe("true only if the amount or deadline is missing or ambiguous"),
  question: z.string().nullable().describe("one short question when needsClarification is true, else null"),
  description: z.string().describe("short plain-English summary, e.g. 'a birthday gift up to $60 by Friday'"),
  maxUsd: z.number().nullable().describe("the most the single purchase may cost, in USD"),
  category: z.string().nullable().describe("one of the known store categories if the request names a kind of thing, else null"),
  merchantId: z.string().nullable().describe("a known merchant id if the request names a store, else null"),
  expiresOn: z.string().nullable().describe("last day it can be used, YYYY-MM-DD, resolved from words like 'by Friday' using today's date"),
});

export type GrantDraft = { description: string; amountCents: number; category: string | null; merchantId: string | null; expiresAt: string };
export type GrantCompileResult = { kind: "draft"; draft: GrantDraft } | { kind: "clarify"; question: string } | { kind: "error"; message: string };

/** End of `ymd` in the owner's time zone (tzOffset = Date#getTimezoneOffset(), minutes behind UTC). */
export function endOfDay(ymd: string, tzOffsetMinutes: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59) + tzOffsetMinutes * 60_000);
}

export function validateGrant(d: { amountCents: number; expiresAt: Date }, now = new Date()) {
  if (!(d.amountCents > 0) || d.amountCents > MAX_GRANT_CENTS) return "The amount must be between $0.01 and $1,000.";
  if (d.expiresAt <= now) return "The deadline has to be in the future.";
  if (d.expiresAt.getTime() - now.getTime() > MAX_GRANT_DAYS * 86_400_000) return `One-time allowances can last up to ${MAX_GRANT_DAYS} days.`;
  return null;
}

export async function compileGrant(userId: string, text: string, tzOffsetMinutes: number): Promise<GrantCompileResult> {
  const model = getModel("smart");
  if (!model) return { kind: "error", message: "AI isn't available right now. Use the form instead." };
  await aiQuota(`grant:${userId}`, 15);
  const [cats, merchants] = await Promise.all([
    db().selectDistinct({ c: schema.products.category }).from(schema.products),
    db().select({ id: schema.merchants.id, name: schema.merchants.name }).from(schema.merchants),
  ]);
  const categories = cats.map((c) => c.c).filter((c) => c !== "test");
  const local = new Date(Date.now() - tzOffsetMinutes * 60_000);
  const today = `${local.toISOString().slice(0, 10)} (${local.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })})`;
  let draft: z.infer<typeof Draft>;
  try {
    const { output } = await generateText({
      model,
      maxRetries: 1,
      timeout: 20_000,
      output: Output.object({ schema: Draft }),
      system: [
        "You turn a person's one-off spending permission for their AI shopping agent into structured settings. It allows exactly ONE purchase.",
        `Today is ${today}. 'By Friday' means the coming Friday (today if today is Friday). If no deadline is given, ask for one.`,
        `Known store categories: ${categories.join(", ")}. Map words onto these when they clearly match ('birthday gift' → gifts); otherwise null.`,
        `Known merchants (id = name): ${merchants.filter((m) => !/^(race|wh|ota)-/.test(m.id)).map((m) => `${m.id} = ${m.name}`).join("; ")}.`,
        "Never invent an amount: if none is given, ask.",
      ].join("\n"),
      prompt: text,
    });
    draft = output;
  } catch (e) {
    console.error("[ai grant]", e);
    return { kind: "error", message: "The AI couldn't read that right now. Try again, or use the form." };
  }
  if (draft.needsClarification || draft.maxUsd === null || !draft.expiresOn) {
    return { kind: "clarify", question: draft.question ?? (draft.maxUsd === null ? "Up to how much can it spend?" : "By when?") };
  }
  const expiresAt = endOfDay(draft.expiresOn, tzOffsetMinutes);
  const amountCents = Math.round(draft.maxUsd * 100);
  if (!expiresAt) return { kind: "clarify", question: "By when?" };
  const problem = validateGrant({ amountCents, expiresAt });
  if (problem) return { kind: "error", message: problem };
  return {
    kind: "draft",
    draft: {
      description: draft.description.trim().slice(0, 200) || text.slice(0, 200),
      amountCents,
      category: draft.category && categories.includes(draft.category) ? draft.category : null,
      merchantId: draft.merchantId && merchants.some((m) => m.id === draft.merchantId) ? draft.merchantId : null,
      expiresAt: expiresAt.toISOString(),
    },
  };
}
