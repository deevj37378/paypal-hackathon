# Progress

Repo: https://github.com/deevj37378/paypal-hackathon (public, MIT)

## Done
- **M0 Setup** (verified Nov 3): Next.js 16 + Tailwind + shadcn, Drizzle/Neon schema pushed, Zod env, PayPal REST client (token cache, idempotency, retries, debug_id), `/api/health` → `{"db":"ok","paypal":"ok"}`, MIT license, README skeleton. Dev server pinned to port 3100.
- **M1 Vault spike** (verified Nov 3): **We're on Plan A (PayPal Vault).**
  - Buyer linked PayPal once via JS SDK v6 save-payment flow (`/spike/vault`) → v3 setup token → payment token, stored server-side only.
  - `npm run spike:charge` charged $18.00 with `vault_id` and **no buyer present**. The order came back `COMPLETED` immediately (no separate capture call needed). Then it paid $18.00 to the demo store via Payouts (`SUCCESS`) and refunded the capture (`COMPLETED`).
  - Evidence (sandbox): order `1N9793644K545305J`, capture `7FY19435J0403821V` (now REFUNDED), payout batch `UAAMLBPB5P9EN` / item `S7XMZEEBRMHZC` (SUCCESS), refund `7EJ04581WS3795024`. Re-checked against the PayPal API.

## Next
- **M2**: deterministic rule checker (unit tested) + `request_purchase` end to end (approved → charge → payout; pending_approval; blocked), real sessions replacing the spike user.

## Known issues / decisions
- **Refund after payout:** refunding the buyer after the store was paid leaves the platform covering the amount. Decide in M4: hold payouts until approval/settlement window, or recover the refunded amount from the merchant's next payouts. Fine for the sandbox demo.
- **Client token:** `domains[]` is only sent for non-localhost `APP_URL` (PayPal rejects `localhost`).
- **PayPal plugin MCP:** the `get_order` tool fails with "Unsupported cache mode: default", so we verify through our own REST client instead.
- npm 11 blocks esbuild's postinstall script. It's harmless: tsx and drizzle-kit work without it.
