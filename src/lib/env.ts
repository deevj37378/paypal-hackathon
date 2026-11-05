import { z } from "zod";

/**
 * Server-side environment, validated lazily so `next build` works without secrets.
 * Call `env()` inside request handlers / scripts, never at module top level of client code.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_API_BASE: z.string().url().default("https://api-m.sandbox.paypal.com"),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  STORE_PAYPAL_EMAIL: z.string().email(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars (openssl rand -base64 32)"),
  APP_URL: z.string().url().default("http://localhost:3100"),
  /** Merchant payouts wait this long after capture so a refund can cancel them (settlement window). */
  PAYOUT_HOLD_SECONDS: z.coerce.number().int().min(0).max(30 * 86400).default(900),
  /** Shorter window for demo accounts so judges see the payout land. */
  DEMO_PAYOUT_HOLD_SECONDS: z.coerce.number().int().min(0).max(86400).default(20),
  /** Judge demo mode: one pre-linked sandbox buyer (PayPal vault payment token) shared by all demo accounts. */
  DEMO_PAYMENT_TOKEN_ID: z.string().optional().transform((v) => (v ? v : undefined)),
  DEMO_PAYER_EMAIL: z.string().optional(),
  /** AG Studio trial/commercial licence key (removes the watermark). Optional: Studio works without it. */
  AG_STUDIO_LICENSE_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  /** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. */
  CRON_SECRET: z.string().optional().transform((v) => (v ? v : undefined)),
  AI_PROVIDER: z.enum(["google", "groq"]).default("google"),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  /** Model ids are configurable so a retired free-tier model never takes the app down. */
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_FAST_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  GROQ_FALLBACK_MODEL: z.string().default("openai/gpt-oss-20b"),
  /** Global daily cap on LLM calls across all users (protects the free quota from public judges). */
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(800),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables (see .env.example):\n${problems}`,
    );
  }
  if (!parsed.data.PAYPAL_API_BASE.includes("sandbox")) {
    throw new Error("PAYPAL_API_BASE must point at the PayPal SANDBOX for this project.");
  }
  cached = parsed.data;
  return cached;
}
