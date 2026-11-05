import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { LanguageModelV4, LanguageModelV4Middleware } from "@ai-sdk/provider";
import { wrapLanguageModel } from "ai";
import { env } from "@/lib/env";

/**
 * LLM access for the AI features (rules compiler, explanations, built-in agent).
 *
 * Free tiers have small per-model, per-minute quotas, so instead of one model we use a chain:
 * each free model has its own quota. The primary provider (AI_PROVIDER, google by default) goes
 * first, then the other models in order. A model that just failed with 429/5xx is skipped for a
 * short cooldown so busy minutes don't pay the latency of hitting it on every step.
 * Returns null when no provider is configured: callers degrade gracefully. The AI never decides money.
 */

/** smart: multi-step chat; fast: short explanations; studio: large-context dashboard turns (Gemini first). */
type Tier = "smart" | "fast" | "studio";
type Candidate = { name: string; model: LanguageModelV4 };

const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS = 30_000;
/** "You exceeded your current quota" = daily free quota: no point retrying for a while. */
const QUOTA_COOLDOWN_MS = 10 * 60_000;

function chain(tier: Tier): Candidate[] {
  const e = env();
  const google = e.GOOGLE_GENERATIVE_AI_API_KEY ? createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY }) : null;
  const groq = e.GROQ_API_KEY ? createGroq({ apiKey: e.GROQ_API_KEY }) : null;
  const gm = (id: string): Candidate[] => (google ? [{ name: `google/${id}`, model: google(id) as LanguageModelV4 }] : []);
  const qm = (id: string): Candidate[] => (groq ? [{ name: `groq/${id}`, model: groq(id) as LanguageModelV4 }] : []);
  // Primary model of the preferred provider first, then fast Groq models; the slow-under-load
  // Gemini model goes last for "smart" (multi-step) work.
  const primary = tier === "fast" ? gm(e.GEMINI_FAST_MODEL) : gm(e.GEMINI_MODEL);
  const secondary = tier === "fast" ? gm(e.GEMINI_MODEL) : gm(e.GEMINI_FAST_MODEL);
  const groqs = [...qm(e.GROQ_MODEL), ...qm(e.GROQ_FALLBACK_MODEL)];
  const list =
    tier === "studio"
      ? [...gm(e.GEMINI_MODEL), ...gm(e.GEMINI_FAST_MODEL), ...groqs] // big prompts: Gemini's per-minute token limits are far higher
      : e.AI_PROVIDER === "groq"
        ? [...groqs, ...primary, ...secondary]
        : [...primary, ...groqs, ...secondary];
  return list.filter((c, i) => list.findIndex((x) => x.name === c.name) === i);
}

const status = (e: unknown) => (e as { statusCode?: number })?.statusCode;
const label = (e: unknown) => (status(e) ? `HTTP ${status(e)}` : ((e as Error)?.message?.slice(0, 80) ?? "error"));
/** Quota / overload / transient errors are worth trying the next model for; a 400 (bad request) is not. */
const retryable = (e: unknown) => {
  const s = status(e);
  // Groq rejects a malformed tool call with 400 tool_use_failed: another model may get it right.
  if (s === 400 && /tool_use_failed|tool call validation/i.test((e as Error)?.message ?? "")) return true;
  return s === undefined || s === 404 || s === 408 || s === 429 || s >= 500;
};

/** Order the chain so models in cooldown go last (still tried if everything else fails). */
function ordered(cands: Candidate[]) {
  const now = Date.now();
  const ready = cands.filter((c) => (cooldownUntil.get(c.name) ?? 0) <= now);
  const cooling = cands.filter((c) => (cooldownUntil.get(c.name) ?? 0) > now);
  return [...ready, ...cooling];
}

async function tryChain<T>(cands: Candidate[], call: (m: LanguageModelV4) => PromiseLike<T>): Promise<T> {
  let last: unknown;
  // Two passes: per-minute free quotas often free up within seconds, so after a short pause
  // the whole chain gets one more chance before the user sees an error.
  for (let pass = 0; pass < 2; pass++) {
    if (pass > 0) await new Promise((r) => setTimeout(r, 2500));
    for (const c of pass === 0 ? ordered(cands) : cands) {
      try {
        return await call(c.model);
      } catch (e) {
        last = e;
        if (!retryable(e)) throw e;
        const daily = /quota/i.test((e as Error)?.message ?? "");
        cooldownUntil.set(c.name, Date.now() + (daily ? QUOTA_COOLDOWN_MS : COOLDOWN_MS));
        console.warn(`[ai] ${c.name} failed (${label(e)}), trying the next model`);
      }
    }
  }
  throw last;
}

/** Middleware that runs every model call (each agent step) through the fallback chain. */
function chainMiddleware(cands: Candidate[]): LanguageModelV4Middleware {
  return {
    specificationVersion: "v4",
    wrapGenerate: async ({ params }) => tryChain(cands, (m) => m.doGenerate(params)),
    wrapStream: async ({ params }) => tryChain(cands, (m) => m.doStream(params)),
  };
}

export function getModel(tier: Tier = "smart"): LanguageModelV4 | null {
  const cands = chain(tier);
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0].model;
  return wrapLanguageModel({ model: cands[0].model, middleware: chainMiddleware(cands) }) as LanguageModelV4;
}

export const aiConfigured = () => chain("fast").length > 0;
