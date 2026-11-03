# Progress

Repo: https://github.com/deevj37378/paypal-hackathon (public, MIT)

## Done
- **M0 Setup** (Nov 3): Next.js 16, Neon + Drizzle, Zod env, PayPal REST client, health check, MIT license. Dev server on port 3100.
- **M1 Vault spike** (Nov 3): **Plan A (PayPal Vault) confirmed.** Vaulted buyer charged with no buyer present, payout to store, refund. Sandbox order `1N9793644K545305J`.
- **M2 Rule checker + purchase flow** (Nov 3), verified end to end in sandbox:
  - Deterministic checker `src/lib/policy/check.ts` + 26 unit tests (`npm test`). Strict Zod `PolicyRules`.
  - Agent REST API `POST /api/v1/purchases`, `GET /api/v1/purchases/:id` with per-agent hashed keys. Store sets prices and categories; agent total must match.
  - Demo story verified: $18 coffee → charged · $32 book → held → approved on dashboard → charged · mug → blocked (category) · $48 book → blocked (per-order) · new merchant → held → declined · wrong total → blocked · same idempotency key → same purchase, no second charge.
  - Vault `usage_pattern: UNSCHEDULED_PREPAID`; orders send `stored_credential {MERCHANT, SUBSEQUENT, UNSCHEDULED_PREPAID}`. Both accepted by sandbox.
  - Settlement window: refund inside the hold → payout cancelled; refund after payout → $32 clawback; next $16 payout fully offset (clawback left $16).
  - Kill switch: revoked agent's next request → 401.
  - Real sessions (signed httpOnly cookie, per-browser accounts); `/spike` removed; same-origin checks on cookie-authenticated POSTs; `/api/health` hides error details in production.
  - Pages: landing, link PayPal, dashboard (spend meter, rules, approvals, agents with kill switch, purchases with refund, live refresh).

## Next
- Deploy to Vercel for the Nov 5 Devpost draft.
- **M3**: MCP server (`search_store`, `get_allowance_status`, `request_purchase`, `get_purchase_status`) over the same service; test with Claude Desktop + MCP Inspector.

## Known issues / decisions
- **Accounts are per-browser** (no email/password): zero cost, nothing to phish. "Try the demo" seeding comes in M6.
- **Payouts with no cron:** Vercel Hobby cron runs daily, so payouts are mainly triggered by the open dashboard (every 4s) and right after capture when the hold is 0. Daily cron is the backstop.
- **Charge timeouts:** if PayPal charges but our request times out, the purchase is marked failed even though money moved. The stable PayPal-Request-Id makes a retry safe; reconciliation via webhooks comes in M4.
- **Payout status "sent"** is confirmed by polling on dashboard ticks until webhooks land (M4).
- **PayPal plugin MCP** `get_order` fails ("Unsupported cache mode: default"); we verify through our own REST client.
- npm 11 blocks esbuild's postinstall script. It's harmless.
