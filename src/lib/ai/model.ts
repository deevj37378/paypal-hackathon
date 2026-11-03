import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModelV4, LanguageModelV4Middleware } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import { env } from "@/lib/env";

/**
 * LLM access for the three AI features (rules compiler, explanations, built-in agent).
 * Provider is chosen by AI_PROVIDER (google default) and falls back to the other provider
 * automatically when the primary errors (e.g. 429 free-tier quota). Returns null when no
 * provider is configured: callers must degrade gracefully. The AI never decides money.
 */

type Tier = "smart" | "fast";

function candidates(tier: Tier): { name: "google" | "groq"; model: LanguageModelV4 }[] {
  const e = env();
  const google = e.GOOGLE_GENERATIVE_AI_API_KEY
    ? {
        name: "google" as const,
        model: createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY })(tier === "fast" ? e.GEMINI_FAST_MODEL : e.GEMINI_MODEL) as LanguageModelV4,
      }
    : null;
  const groq = e.GROQ_API_KEY ? { name: "groq" as const, model: createGroq({ apiKey: e.GROQ_API_KEY })(e.GROQ_MODEL) as LanguageModelV4 } : null;
  const ordered = e.AI_PROVIDER === "groq" ? [groq, google] : [google, groq];
  return ordered.filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Middleware: if the primary model fails to start a call, transparently retry on the fallback model. */
function fallbackTo(fallback: LanguageModelV4, label: string): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ doGenerate, params }) => {
      try {
        return await doGenerate();
      } catch (e) {
        console.warn(`[ai] primary failed (${errLabel(e)}), falling back to ${label}`);
        return fallback.doGenerate(params);
      }
    },
    wrapStream: async ({ doStream, params }) => {
      try {
        return await doStream();
      } catch (e) {
        console.warn(`[ai] primary stream failed (${errLabel(e)}), falling back to ${label}`);
        return fallback.doStream(params);
      }
    },
  };
}

const errLabel = (e: unknown) => {
  const status = (e as { statusCode?: number })?.statusCode;
  return status ? `HTTP ${status}` : (e as Error)?.message?.slice(0, 80) ?? "error";
};

export function getModel(tier: Tier = "smart"): LanguageModelV4 | null {
  const [primary, secondary] = candidates(tier);
  if (!primary) return null;
  if (!secondary) return primary.model;
  return wrapLanguageModel({ model: primary.model, middleware: fallbackTo(secondary.model, secondary.name) }) as LanguageModelV4;
}

export const aiConfigured = () => candidates("fast").length > 0;
