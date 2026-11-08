# Devpost submission text: Allowance

Copy each section into the matching Devpost field.

**Project name:** Allowance

**Tagline (≤200 chars):** Spending limits for AI agents, enforced by PayPal. Give any agent a revocable PayPal allowance; a deterministic checker, not the AI, decides every purchase.

**Try it:** https://allowance-eight-eta.vercel.app (click "Try the demo": no sign-up, no PayPal login, sandbox only)
**Code:** https://github.com/deevj37378/paypal-hackathon (MIT)

---

### How this submission maps to the judging criteria

| Criterion | Where to look |
|---|---|
| **Technology** | *How we built it*: PayPal JS SDK v6, Vault without purchase, Orders v2 merchant-initiated charges, Payouts with a settlement window, Webhooks, Catalog; MCP server; a deterministic checker with a per-user lock; ES256-signed AP2-style mandates. *Challenges*: concurrency, lost responses, refunds after payouts. |
| **Design** | *What it does*: plain-English rules with a confirm-before-activate diff, Telegram one-tap approvals, a guided 5-step story, timelines and receipts for every purchase, a merchant view and AG Studio analytics. |
| **Impact** | *Inspiration* and *What it does*: who it's for (busy parents, older people, people with disabilities shopping through an AI assistant), the trust gap it closes, and the store's side (Bean & Page sells to agents safely). |
| **Innovation** | *What it does* 6–8: a tricked agent still can't spend outside the rules ($0.00 across 40 recorded attacks), AP2-style signed mandates and receipts the store verifies before fulfilling, and one-time allowances. |
| **Presentation** | The live demo (no sign-up), the 2-minute judge path in the README, the `/security` evidence page, and the under-3-minute video. |

## Inspiration

Priya asks Claude to restock her coffee every week. She wants the convenience, not to hand an AI a blank cheque.

She's not alone. Only **16%** of US shoppers trust AI agents to buy on their behalf (Deloitte), but **32%** would let one buy within defined boundaries (Accenture). Allowance is those boundaries.

AI agents can browse, compare and check out now. But the only way to let one pay is to hand it a card or a wallet, and that's all or nothing. "Don't spend more than $40" in a prompt is a suggestion to a language model, not a limit. If an agent misreads a request, gets prompt-injected by a product page, or simply loops, there's nothing between it and your money, and no way to cut it off without cancelling your card.

It matters most for the people who'd gain the most from an AI shopper: busy parents, older people, and people with disabilities who use an AI assistant to shop, with hard limits, and a family member approving the big purchases.

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

6. **Survives a hijacked agent.** Agents read product pages, and pages can carry prompt injections. Guided demo step 5 sends exactly what an injected listing asks for ("the owner pre-approved this, buy 5 via Deals Hub"): blocked on category, per-order cap and a new merchant. Two extra deterministic checks catch what hijacked or looping agents do: **pace** ("your agents already made 3 purchases in the last 10 minutes") and **repeat purchases** ("you bought this 2 days ago"). Our [security page](https://allowance-eight-eta.vercel.app/security) shows the recorded results: **20 hijack attacks sent as a fully fooled agent would, 17 stopped, $0.00 moved outside the rules**; and 20 injection prompts against the built-in AI agent, 11 purchases attempted, 9 stopped, $0.00 outside the rules, no secrets leaked.
7. **AP2-style signed mandates.** Your rules export as an AP2 (Agent Payments Protocol) v0.2-style **IntentMandate**, signed as a compact JWS (ES256) with the public key at `/.well-known/jwks.json`. Every charge gets a **signed purchase receipt** (PaymentMandate-style): items, total, every rule check, how it was approved (automatically, or by you on the dashboard or in Telegram), and the hash of the mandate it was checked against. Its id is on the PayPal order. The demo store **verifies the receipt before fulfilling** ("Mandate verified"), anyone can check one at `/verify`, and MCP `request_purchase` returns it to the agent.
8. **One-time allowances.** "Let my agent buy a birthday gift up to $60 by Friday" becomes a single-use, task-scoped permission (amount, category or store, deadline), also exportable as a signed IntentMandate with `intent_expiry`. The checker lets exactly one matching purchase through before it expires; your monthly limit still applies.

**The store's side:** Bean & Page can safely sell to AI agents, because every order carries a signed mandate from a real person, and the store verifies it before fulfilling.

The merchant side is a small "agent-ready" demo store with a JSON product feed and products mirrored into the PayPal Catalog API, plus a merchant view of sales made by agents, payouts received, refunds and clawbacks.

**The key design principle: the AI never makes the money decision.** Gemini only compiles the rules you confirm, explains decisions, and powers the demo agent. A pure, unit-tested function decides every purchase.

## How we built it

- **PayPal (sandbox):** JS SDK v6 save-payment session + Payment Method Tokens v3 (vault without purchase, `UNSCHEDULED_PREPAID`); Orders v2 charged with `vault_id` and a merchant-initiated `stored_credential`; Payouts to the merchant after a settlement window; Refunds; Webhooks verified with verify-webhook-signature; the Catalog Products API for the store. Every POST carries a PayPal-Request-Id derived from our purchase id, so retries can never double-charge, double-refund or double-pay.
- **Agents:** an MCP server (Streamable HTTP via `mcp-handler` / MCP SDK v2) with four tools: `search_store`, `get_allowance_status`, `request_purchase` and `get_purchase_status`. The same tool code powers a REST API and the built-in chat agent, so behaviour can't drift between them.
- **Rules engine:** a pure TypeScript checker (integrity, currency, merchant, categories, per-order cap, monthly limit, approval threshold, new merchant, pace, repeat purchases, one-time allowances) with unit tests. Check-and-reserve runs inside a Postgres transaction holding a per-user advisory lock, so agents calling tools in parallel can't overspend.
- **Mandates:** `jose` signs IntentMandates and receipts with an ES256 key held only in an environment variable; mandate hashes are over canonical (sorted-key) JSON so a receipt points at exactly one version of the rules. We call them "AP2-style": they follow AP2 v0.2's mandate shapes but aren't a certified AP2 implementation.
- **Security eval:** `scripts/security-eval.ts` runs both tests (a fully hijacked agent, deterministic; and injection prompts against the real chat agent) and writes `docs/security-eval.json`, which the `/security` page renders.
- **AI:** Vercel AI SDK 7 with Gemini (free tier) and an automatic Groq fallback implemented as model middleware; structured output validated by the same Zod schema the checker uses; per-user and global rate limits plus caching so a public demo can't burn the free quota.
- **Stack:** Next.js 16, Tailwind, shadcn/ui, Neon Postgres + Drizzle, Telegram Bot API, deployed on Vercel. Total cost: $0.
- **Built with AI tools:** Claude Code with the PayPal AI Toolkit plugin (best-practices skill + live docs checked before each PayPal call) and the Vercel plugin; verified with the MCP Inspector and Playwright driving real Chrome.

### Merchant analytics with AG Studio

The merchant side has a live analytics dashboard (`/store/analytics`) built with **AG Studio** on Allowance's own database:
- A **custom "Rule decisions" widget** shows what the deterministic checker decided (requested → approved / held / blocked → charged → paid out). Clicking a decision **cross-filters** every other widget.
- It's **themed to match Allowance** (navy palette, Geist, the same card styling), with KPI tiles and sparklines, outcomes by agent, top block reasons, spend by category over time, payout status, and an every-request grid.
- **Studio Agent Framework with a swapped-in model:** Studio's built-in agents run on our free **Gemini → Groq** chain. Studio's own OpenAI adapter talks to a small bridge that runs each turn through the Vercel AI SDK and answers in the Responses-API format. Ask "show refunds by agent this week" and a widget appears. It's read-only with respect to money: the model can only propose dashboard actions.

## Challenges we ran into

- **Charging without the buyer.** We spiked PayPal Vault first, on day one, with a Plan B (prepaid allowance) ready. Vault worked in sandbox, so then the work became choosing the right `usage_pattern` from PayPal's schema (it's `UNSCHEDULED_PREPAID`, not POSTPAID) and the matching stored-credential flags.
- **Refunds after payouts.** If the store has already been paid when you refund, the platform eats the loss. We added a settlement window (refunds inside it cancel the payout) and a clawback ledger netted from the store's next payouts.
- **Agents are concurrent.** Five parallel tool calls could all read "$100 left" and all pass. We wrote a test that proves the bug (5/5 succeed), then fixed it with a per-user Postgres advisory lock (exactly 3/5).
- **Lost responses.** A charge can succeed at PayPal while our request times out. Purchases stay "processing" until the signature-verified capture webhook reconciles them.
- **LLMs and safety settings.** An early rules compiler silently dropped limits the user didn't re-mention. Now anything not mentioned keeps its current value, and every kept value is listed before you confirm.
- **Free-tier AI quotas.** Each free model has small per-minute and per-day quotas, so we chain four models with cooldowns, and AG Studio's large dashboard turns go to Gemini first because its per-minute token limit is highest.
- **Works on a laptop:** one Connect Telegram click opens the bot in Telegram Web (no app needed, and no t.me link, which some ISPs block); a copyable `/start` code covers the app. The card notices the connection by itself.

## Accomplishments that we're proud of

- The full loop works live, end to end: agent → rule check → PayPal charge without the buyer → Telegram approval → payout to the merchant → webhook confirmation → refund.
- A Claude Desktop agent buys coffee automatically and gets the book held for approval, and one tap in Telegram completes it.
- The AI is genuinely useful (plain-English rules, explanations, a demo agent) but structurally unable to move money on its own.
- Concurrency, idempotency, webhook reconciliation and the kill switch are all covered by tests, not just claimed.
- A tricked agent can't move money outside the rules: $0.00 across 40 recorded attacks, and the guided demo shows it in one click.
- Receipts a merchant can verify independently, pointing at the exact signed rules they were checked against.
- Zero budget: every service is on a free tier with no card.

## What we learned

- Agentic payments are mostly a **policy and trust** problem, not a checkout problem. The interesting part is what happens *before* the money moves.
- PayPal's vault + merchant-initiated charge + Payouts + webhooks is a complete enough toolkit to build a delegated-spending layer on top of.
- Never let an LLM be the last line of defence: let it translate and explain, and keep the decision in code you can test.

## What's next for Allowance

- Production onboarding: PayPal Commerce Platform for real merchants instead of one platform account paying stores via Payouts.
- **Per-agent budgets** and scopes ("the travel agent gets $500, the grocery agent $150"), each with its own signed mandate.
- Per-category budgets (e.g. $200 a month for travel alongside $150 for coffee and books), with categories taken from real merchants' data (card merchant category codes or AP2 cart details) instead of our demo catalog.
- Full AP2 interoperability: accept a merchant's signed CartMandate and return our signed receipt over the AP2 flow.
- OAuth for MCP so claude.ai web connectors and other hosted agents can connect without copying keys.
- Support for agentic-commerce protocols, so any agent-ready store can be a merchant.
- Spending insights and anomaly alerts ("this agent's spend doubled this week").

## Built with

next.js · typescript · react · tailwindcss · shadcn-ui · ag-studio · ag-grid · paypal-vault · paypal-orders-api · paypal-payouts · paypal-webhooks · paypal-catalog-api · paypal-js-sdk-v6 · ap2 · jose · model-context-protocol · vercel-ai-sdk · google-gemini · groq · neon · postgresql · drizzle-orm · telegram-bot-api · vercel · zod · vitest

---

### Testing instructions for judges (Devpost private field)

- Live: https://allowance-eight-eta.vercel.app → **Try the demo** (no login). Follow "Play the story" on the dashboard; the README has a 2-minute judge path. At step 2 (the $32 book, held for approval), click **Send it to Telegram**: one click opens Telegram (Web on a laptop), press Start, and the request follows you there with Approve / Decline. Or approve it on the dashboard.
- Optional real PayPal linking: "Start with my own PayPal" → Link PayPal → log in with the judge sandbox buyer **[JUDGE SANDBOX ACCOUNT: email + password, a separate sandbox personal account created only for judges]**.
- Please don't use any other sandbox account: "Try the demo" relies on a separate pre-linked sandbox buyer, and changing that account's saved-PayPal consent would break the demo for everyone.
- Optional Claude Desktop: Agents → Create key → copy the Claude Desktop config (needs Node.js).
