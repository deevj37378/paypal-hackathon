import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { aiQuota } from "./limits";
import { getModel } from "./model";

type Purchase = typeof schema.purchases.$inferSelect;

/**
 * One short plain-English explanation of a held or blocked purchase, cached on the purchase.
 * The explanation never changes the decision: it only rephrases the deterministic checker's output.
 * Falls back to the checker's own reasons whenever the AI is unavailable.
 */
export async function explainDecision(p: Purchase): Promise<{ text: string; source: "ai" | "rules" }> {
  const fallback = { text: p.decision.reasons.join(" "), source: "rules" as const };
  if (p.decision.outcome === "approved") return fallback; // nothing to explain
  if (p.aiExplanation) return { text: p.aiExplanation, source: "ai" };
  const model = getModel("fast");
  if (!model) return fallback;
  try {
    await aiQuota(`explain:${p.userId}`, 40);
    const facts = p.decision.checks.map((c) => `- ${c.label}: ${c.status.toUpperCase()} (${c.detail})`).join("\n");
    const { text } = await generateText({
      model,
      maxRetries: 1,
      timeout: 15_000, // streams behind Suspense; leaves room for a Gemini 503 + Groq fallback
      system:
        "You are Allowance, explaining a spending-rule decision to the account owner in 1–2 short, friendly sentences (max 45 words), addressing them as \"you\" and calling the agent \"your agent\". Say what was requested and which rule caused the outcome; if it is held, say you can approve or decline it. Never offer to do anything yourself, don't second-guess the decision, don't invent numbers, no markdown.",
      prompt: `Outcome: ${p.decision.outcome === "pending_approval" ? "held for the owner's approval" : p.decision.outcome}.\nOrder: ${p.items
        .map((i) => `${i.quantity}× ${i.name} (${i.category})`)
        .join(", ")}, total ${formatUsd(p.totalCents)}.\n${p.reason ? `Agent's reason: ${p.reason}\n` : ""}Rule checks:\n${facts}`,
    });
    const clean = text.trim().replace(/\s+/g, " ").slice(0, 400);
    if (!clean) return fallback;
    await db().update(schema.purchases).set({ aiExplanation: clean }).where(eq(schema.purchases.id, p.id));
    return { text: clean, source: "ai" };
  } catch (e) {
    console.warn("[ai explain] falling back to checker reasons:", (e as Error).message?.slice(0, 120));
    return fallback;
  }
}
