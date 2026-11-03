import { generateText, Output } from "ai";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { PolicyRules } from "@/lib/policy/schema";
import { getActivePolicy } from "@/lib/users";
import { aiQuota, cacheGet, cacheSet, hashKey } from "./limits";
import { getModel } from "./model";

/**
 * Plain English → strict PolicyRules. The model fills an LLM-friendly shape (dollars, nullable
 * fields, a clarification channel); we convert to cents and validate with the same Zod schema the
 * checker uses. Nothing here activates rules: the human confirms first.
 */
const Draft = z.object({
  needsClarification: z.boolean().describe("true only if a rule is genuinely ambiguous or contradictory"),
  question: z.string().nullable().describe("one short clarifying question when needsClarification is true, else null"),
  monthlyLimitUsd: z.number().nullable().describe("total allowed per calendar month in USD"),
  perOrderLimitUsd: z.number().nullable().describe("max for a single order in USD, null if not mentioned"),
  approvalAboveUsd: z.number().nullable().describe("orders strictly above this USD amount need the owner's approval; null if not mentioned"),
  allowedCategories: z.array(z.string()).describe("only these categories may be bought; [] means any"),
  blockedCategories: z.array(z.string()).describe("categories that must never be bought"),
  blockedMerchants: z.array(z.string()).describe("merchant ids that must never be used"),
  trustedMerchants: z.array(z.string()).describe("merchant ids the owner explicitly trusts"),
  requireApprovalForNewMerchants: z
    .boolean()
    .nullable()
    .describe("true/false only if the person says whether to ask before buying from new merchants; null if not mentioned"),
  assumptions: z.array(z.string()).describe("short notes on anything you assumed or normalised, in plain English"),
});

export type CompileResult =
  | { kind: "rules"; rules: PolicyRules; assumptions: string[]; provider: "ai" }
  | { kind: "clarify"; question: string }
  | { kind: "error"; message: string };

const slug = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

async function storeVocabulary() {
  const cats = await db().selectDistinct({ c: schema.products.category }).from(schema.products);
  const merchants = await db().select({ id: schema.merchants.id, name: schema.merchants.name }).from(schema.merchants).where(sql`${schema.merchants.id} not like 'race-%' and ${schema.merchants.id} not like 'wh-%'`);
  return { categories: cats.map((c) => c.c).sort(), merchants };
}

/** Map near-misses ("book", "Books", "coffees") onto the store's category slugs. */
function normaliseCategory(raw: string, known: string[]) {
  const s = slug(raw);
  if (known.includes(s)) return s;
  const hit = known.find((k) => k.replace(/s$/, "") === s.replace(/s$/, ""));
  return hit ?? s;
}

export async function compileRules(userId: string, text: string): Promise<CompileResult> {
  const model = getModel("smart");
  if (!model) return { kind: "error", message: "AI rule translation isn't available right now. You can still edit your rules with the form." };
  const [vocab, current] = await Promise.all([storeVocabulary(), getActivePolicy(userId)]);
  const keepTrusted = current?.rules.trustedMerchants ?? [];
  const cacheKey = hashKey("compile:v3", text.trim().toLowerCase(), JSON.stringify(vocab), keepTrusted.join(","), String(current?.rules.requireApprovalForNewMerchants ?? true));
  const cached = await cacheGet<CompileResult>(cacheKey);
  if (cached) return cached;

  await aiQuota(`compile:${userId}`, 15);
  let draft: z.infer<typeof Draft>;
  try {
    const { output } = await generateText({
      model,
      maxRetries: 1,
      timeout: 20_000,
      output: Output.object({ schema: Draft }),
      system: [
        "You convert a person's plain-English spending rules for their AI shopping agent into structured settings.",
        "Never invent limits the person didn't state. Amounts are USD. 'Ask me/check with me before X' means approvalAboveUsd. 'Max/at most X per order' means perOrderLimitUsd. 'X a month/per month' means monthlyLimitUsd.",
        "If no monthly limit is stated, set needsClarification=true and ask for one: a monthly limit is required.",
        `Known store categories: ${vocab.categories.join(", ")}. Map the person's words onto these when they clearly match (e.g. "book" → "books").`,
        `Known merchants (id = name): ${vocab.merchants.map((m) => `${m.id} = ${m.name}`).join("; ")}. Use ids.`,
        "Ask a clarifying question only when a rule is genuinely ambiguous or contradictory (e.g. a per-order cap larger than the monthly limit). Otherwise produce settings and list assumptions.",
      ].join("\n"),
      prompt: text,
    });
    draft = output;
  } catch (e) {
    console.error("[ai compile]", e);
    return { kind: "error", message: "The AI couldn't translate those rules right now. Try again in a minute, or use the form." };
  }

  let result: CompileResult;
  if (draft.needsClarification && draft.question) {
    result = { kind: "clarify", question: draft.question };
  } else {
    const cents = (usd: number | null) => (usd === null ? null : Math.round(usd * 100));
    const candidate = {
      version: 1 as const,
      currency: "USD" as const,
      monthlyLimitCents: cents(draft.monthlyLimitUsd),
      perOrderLimitCents: cents(draft.perOrderLimitUsd),
      approvalThresholdCents: cents(draft.approvalAboveUsd),
      allowedCategories: [...new Set(draft.allowedCategories.map((c) => normaliseCategory(c, vocab.categories)))].filter(Boolean),
      blockedCategories: [...new Set(draft.blockedCategories.map((c) => normaliseCategory(c, vocab.categories)))].filter(Boolean),
      blockedMerchants: [...new Set(draft.blockedMerchants.map(slug))].filter(Boolean),
      // Trusted merchants carry over unless the new text names some (they only skip the "new merchant" hold).
      trustedMerchants: draft.trustedMerchants.length ? [...new Set(draft.trustedMerchants.map(slug))].filter(Boolean) : keepTrusted,
      // Safety settings the text doesn't mention keep their current value instead of silently turning off.
      requireApprovalForNewMerchants: draft.requireApprovalForNewMerchants ?? current?.rules.requireApprovalForNewMerchants ?? true,
    };
    const parsed = PolicyRules.safeParse(candidate);
    if (!parsed.success) {
      result =
        candidate.monthlyLimitCents === null
          ? { kind: "clarify", question: "How much should your agents be able to spend per month in total?" }
          : { kind: "error", message: "Those rules didn't translate into valid settings. Try rephrasing, or use the form." };
    } else if (parsed.data.perOrderLimitCents !== null && parsed.data.perOrderLimitCents > parsed.data.monthlyLimitCents) {
      result = { kind: "clarify", question: "Your per-order limit is bigger than your monthly limit. Which one should win?" };
    } else {
      let notes = draft.assumptions.slice(0, 5);
      if (!draft.trustedMerchants.length && keepTrusted.length) {
        notes = notes.filter((n) => !/trusted/i.test(n));
        const names = keepTrusted.map((id) => vocab.merchants.find((m) => m.id === id)?.name ?? id);
        notes.push(`Kept your trusted merchants (${names.join(", ")}), so they don't count as "new".`);
      }
      result = { kind: "rules", rules: parsed.data, assumptions: notes, provider: "ai" };
    }
  }
  if (result.kind !== "error") await cacheSet(cacheKey, result);
  return result;
}
