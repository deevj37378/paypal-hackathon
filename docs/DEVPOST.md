# Devpost submission text: Allowance

Copy each section into the matching Devpost field.

**Project name:** Allowance

**Tagline (≤200 chars):** Spending limits for AI agents, enforced by PayPal. Give any agent a revocable PayPal allowance; a deterministic checker, not the AI, decides every purchase.

**Try it:** https://allowance-eight-eta.vercel.app (click "Try the demo": no sign-up, no PayPal login, sandbox only)
**Code:** https://github.com/deevj37378/paypal-hackathon (MIT)

---

## Inspiration

AI agents can browse, compare and check out now. But the only way to let one pay is to hand it a card or a wallet, and that's all or nothing. "Don't spend more than $40" in a prompt is a suggestion to a language model, not a limit. If an agent misreads a request, gets prompt-injected by a product page, or simply loops, there's nothing between it and your money, and no way to cut it off without cancelling your card.

We wanted the agent equivalent of a teenager's allowance: a fixed budget, clear rules, "ask me first" for the big stuff, and a switch that turns it off instantly. Enforced by the payment rail, not by the agent's good behaviour.

## What it does

Allowance gives any AI agent (Claude, ChatGPT, or your own) a limited, revocable PayPal spending permission.

1. **Write rules in plain English:** "$150 a month, only coffee and books, max $40 per order, ask me before anything over $25, never buy from new merchants without asking." Gemini turns that into a strict policy and shows it as readable rule cards, with changes highlighted. Nothing is active until you confirm.
2. **Link PayPal once** with PayPal Vault (buyer consent). Agents never see your account.
3. **Connect an agent:** Claude Desktop or Claude Code over our MCP server, any agent over REST, or the built-in chat agent. Each agent gets its own key.
4. **Every purchase is checked by a deterministic rule engine:**
   - within the rules → charged to your saved PayPal with no interaction, then paid out to the store;
   - over your "ask me" threshold or from a new merchant → held, and you get **Approve / Decline buttons in Telegram** (or on the dashboard);
   - against the rules → blocked, and the agent gets a plain-English reason ("Kitchen isn't in your allowed categories").
5. **Stay in control:** a live dashboard (spend vs limit, purchases, per-agent activity), a timeline for every purchase, one-tap refunds, and a **kill switch** that revokes an agent on its very next request, even mid-conversation.

The merchant side is a small "agent-ready" demo store with a JSON product feed and products mirrored into the PayPal Catalog API, plus a merchant view of sales made by agents, payouts received, refunds and clawbacks.

**The key design principle: the AI never makes the money decision.** Gemini only compiles the rules you confirm, explains decisions, and powers the demo agent. A pure, unit-tested function decides every purchase.

## How we built it

- **PayPal (sandbox):** JS SDK v6 save-payment session + Payment Method Tokens v3 (vault without purchase, `UNSCHEDULED_PREPAID`); Orders v2 charged with `vault_id` and a merchant-initiated `stored_credential`; Payouts to the merchant after a settlement window; Refunds; Webhooks verified with verify-webhook-signature; the Catalog Products API for the store. Every POST carries a PayPal-Request-Id derived from our purchase id, so retries can never double-charge, double-refund or double-pay.
- **Agents:** an MCP server (Streamable HTTP via `mcp-handler` / MCP SDK v2) with four tools: `search_store`, `get_allowance_status`, `request_purchase` and `get_purchase_status`. The same tool code powers a REST API and the built-in chat agent, so behaviour can't drift between them.
- **Rules engine:** a pure TypeScript checker (integrity, currency, merchant, categories, per-order cap, monthly limit, approval threshold, new merchant) with unit tests. Check-and-reserve runs inside a Postgres transaction holding a per-user advisory lock, so agents calling tools in parallel can't overspend.
- **AI:** Vercel AI SDK 7 with Gemini (free tier) and an automatic Groq fallback implemented as model middleware; structured output validated by the same Zod schema the checker uses; per-user and global rate limits plus caching so a public demo can't burn the free quota.
- **Stack:** Next.js 16, Tailwind, shadcn/ui, Neon Postgres + Drizzle, Telegram Bot API, deployed on Vercel. Total cost: $0.
- **Built with AI tools:** Claude Code with the PayPal AI Toolkit plugin (best-practices skill + live docs checked before each PayPal call) and the Vercel plugin; verified with the MCP Inspector and Playwright driving real Chrome.

## Challenges we ran into

- **Charging without the buyer.** We spiked PayPal Vault first, on day one, with a Plan B (prepaid allowance) ready. Vault worked in sandbox, so then the work became choosing the right `usage_pattern` from PayPal's schema (it's `UNSCHEDULED_PREPAID`, not POSTPAID) and the matching stored-credential flags.
- **Refunds after payouts.** If the store has already been paid when you refund, the platform eats the loss. We added a settlement window (refunds inside it cancel the payout) and a clawback ledger netted from the store's next payouts.
- **Agents are concurrent.** Five parallel tool calls could all read "$100 left" and all pass. We wrote a test that proves the bug (5/5 succeed), then fixed it with a per-user Postgres advisory lock (exactly 3/5).
- **Lost responses.** A charge can succeed at PayPal while our request times out. Purchases stay "processing" until the signature-verified capture webhook reconciles them.
- **LLMs and safety settings.** An early rules compiler silently dropped limits the user didn't re-mention. Now anything not mentioned keeps its current value, and every kept value is listed before you confirm.
- **Real-world networks:** t.me links are blocked on some ISPs, so Telegram can also be connected via a `tg://` link or a copyable `/start` code.

## Accomplishments that we're proud of

- The full loop works live, end to end: agent → rule check → PayPal charge without the buyer → Telegram approval → payout to the merchant → webhook confirmation → refund.
- A Claude Desktop agent buys coffee automatically and gets the book held for approval, and one tap in Telegram completes it.
- The AI is genuinely useful (plain-English rules, explanations, a demo agent) but structurally unable to move money on its own.
- Concurrency, idempotency, webhook reconciliation and the kill switch are all covered by tests, not just claimed.
- Zero budget: every service is on a free tier with no card.

## What we learned

- Agentic payments are mostly a **policy and trust** problem, not a checkout problem. The interesting part is what happens *before* the money moves.
- PayPal's vault + merchant-initiated charge + Payouts + webhooks is a complete enough toolkit to build a delegated-spending layer on top of.
- Never let an LLM be the last line of defence: let it translate and explain, and keep the decision in code you can test.

## What's next for Allowance

- Production onboarding: PayPal Commerce Platform for real merchants instead of one platform account paying stores via Payouts.
- Per-agent budgets and scopes ("the travel agent gets $500, the grocery agent $150").
- OAuth for MCP so claude.ai web connectors and other hosted agents can connect without copying keys.
- Support for agentic-commerce protocols, so any agent-ready store can be a merchant.
- Spending insights and anomaly alerts ("this agent's spend doubled this week").

## Built with

next.js · typescript · react · tailwindcss · shadcn-ui · paypal-vault · paypal-orders-api · paypal-payouts · paypal-webhooks · paypal-catalog-api · paypal-js-sdk-v6 · model-context-protocol · vercel-ai-sdk · google-gemini · groq · neon · postgresql · drizzle-orm · telegram-bot-api · vercel · zod · vitest

---

### Testing instructions for judges (Devpost private field)

- Live: https://allowance-eight-eta.vercel.app → **Try the demo** (no login). Follow "Play the story" on the dashboard; the README has a 2-minute judge path.
- Optional real PayPal linking: "Start with my own PayPal" → Link PayPal → log in with sandbox buyer **[add sandbox personal email + password here]**.
- Optional Claude Desktop: Agents → Create key → copy the Claude Desktop config (needs Node.js).
