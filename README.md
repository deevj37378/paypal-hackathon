# Allowance

**Spending limits for AI agents, enforced by PayPal.**

AI agents can shop now, but nothing stops one from overspending or buying the wrong thing. Allowance lets you give any agent (Claude, ChatGPT, or your own) a limited, revocable PayPal spending permission. You write the rules in plain English. A deterministic checker enforces them on every purchase.

> **Design principle: the AI never makes the final money decision.**
> A deterministic, unit-tested rule checker approves, holds, or blocks every purchase. The LLM is used only to
> (a) compile your English rules into a strict JSON policy that you confirm,
> (b) explain held or blocked purchases in plain English, and
> (c) power the built-in shopping agent.
> This keeps the system safe and LLM calls few.

## How it works
_TODO (M7): architecture diagram._

1. Write rules in English → Gemini compiles them into a Zod-validated policy → you confirm the rule cards.
2. Link PayPal once (PayPal Vault, buyer consent).
3. Connect an agent through the Allowance MCP server, or use the built-in chat agent.
4. Each purchase request is checked against your policy: **approved** (charged to your vaulted PayPal, then paid out to the merchant), **pending approval** (Telegram Approve/Decline), or **blocked** (with a reason).

## Tech
Next.js (App Router) · Tailwind · shadcn/ui · Neon Postgres + Drizzle · Vercel AI SDK (Gemini free tier, Groq fallback) · MCP (streamable HTTP) · PayPal Vault v3, Orders v2, Payouts, Refunds, Webhooks (sandbox) · Telegram Bot API.

## Setup
```bash
npm install
cp .env.example .env.local   # fill in; every value is free and the comments say where to get it
npm run db:push              # create tables in Neon
npm run dev
curl localhost:3000/api/health   # → {"db":"ok","paypal":"ok"}
```

## Sandbox test accounts
_TODO: sandbox-only buyer login for judges._

## License
MIT. See [LICENSE](LICENSE).
