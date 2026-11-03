# Progress

Repo: https://github.com/deevj37378/paypal-hackathon (public, MIT)

## Done
- **M0 Setup** (verified Nov 3): Next.js 16 + Tailwind + shadcn, Drizzle/Neon schema pushed, Zod env, PayPal REST client (token cache, idempotency, retries, debug_id), `/api/health` → `{"db":"ok","paypal":"ok"}`, MIT license, README skeleton. Dev server pinned to port 3100.

## Next
- **M1 Vault spike**: vault the sandbox buyer, charge with no buyer interaction, capture, payout, refund → choose Plan A (Vault) or Plan B (prepaid ledger).

## Known issues
- npm 11 blocks esbuild's postinstall script. It's harmless: tsx and drizzle-kit work without it.
