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

## How a purchase is decided
```
agent ──request_purchase──▶ validate (Zod) ─▶ price & categorise from the store (never trust the agent)
                                       └──▶ deterministic rule checker (src/lib/policy/check.ts, unit tested)
                                              ├─ approved         → charge saved PayPal (Orders v2 + vault_id) → payout held for a settlement window → Payouts to merchant
                                              ├─ pending_approval → owner approves/declines → re-checked (limits still apply) → charge
                                              └─ blocked          → plain-English reason back to the agent
```
- **Settlement window:** merchant payouts wait `PAYOUT_HOLD_SECONDS` (default 15 min; 20 s for demo accounts). A refund inside the window cancels the payout. A refund after it records a clawback that is netted from the merchant's next payouts.
- **Idempotency:** every PayPal POST uses a `PayPal-Request-Id` derived from our purchase id, and agents can pass `idempotency_key`.
- **Kill switch:** each agent has its own hashed API key; revoking it takes effect on the next request.

## Agent API (REST; MCP in M3)
```bash
curl -X POST $APP_URL/api/v1/purchases \
  -H "Authorization: Bearer alw_sk_…" -H "Content-Type: application/json" \
  -d '{"merchant_id":"demo-store","items":[{"product_id":"coffee-house-blend","quantity":1}],"total":"18.00","currency":"USD","reason":"Restock coffee"}'
# → {"purchase_id":"pur_…","status":"approved" | "pending_approval" | "blocked", "reasons":[…], …}
curl $APP_URL/api/v1/purchases/pur_… -H "Authorization: Bearer alw_sk_…"
```

## Tech
Next.js (App Router) · Tailwind · shadcn/ui · Neon Postgres + Drizzle · Vercel AI SDK (Gemini free tier, Groq fallback) · MCP (streamable HTTP) · PayPal Vault v3, Orders v2, Payouts, Refunds, Webhooks (sandbox) · Telegram Bot API.

## Setup
```bash
npm install
cp .env.example .env.local   # fill in; every value is free and the comments say where to get it
npm run db:push              # create tables in Neon
npm run db:seed              # demo merchants + products
npm test                     # rule checker unit tests
npm run dev
curl localhost:3100/api/health   # → {"db":"ok","paypal":"ok"}
```

## Sandbox test accounts
_TODO: sandbox-only buyer login for judges._

## License
MIT. See [LICENSE](LICENSE).
