# Demo video script: Allowance (target 2:43, hard limit under 3:00)

**Setup before recording**
- Fresh demo account: open the live site → Try the demo. Connect Telegram on the dashboard (phone visible or mirrored).
- Claude Desktop already configured with an Allowance key (Agents page → Create key → copy config). Start a fresh chat.
- Browser at 1440 width, zoom 110%, bookmarks bar hidden. Close other tabs.
- Phone screen recorder ready for the Telegram tap (or show Telegram Desktop side by side).

| Time | Shot | Voice-over (read at a calm pace) |
|---|---|---|
| 0:00–0:12 | Landing page hero, slow scroll to the three outcome cards | "AI agents can shop now. But if you give one your card, it can spend anything, anywhere, and 'please don't spend more than forty dollars' in a prompt isn't a limit." |
| 0:12–0:22 | Hold on the hero headline + "The AI never makes the final money decision" | "Allowance gives any AI agent a limited, revocable PayPal allowance. You set the rules, and a deterministic checker enforces them on every purchase. The AI never makes the money decision." |
| 0:22–0:42 | `/rules`: replace the text with "$200 a month, only coffee and books, ask me over $30", click **Translate with AI**, show the highlighted changes and "Kept your $40.00 per-order limit (not mentioned)", click **Activate** | "I write my rules in plain English. Gemini turns them into strict settings and shows me exactly what changes, including what it kept, and nothing is active until I confirm." |
| 0:42–0:50 | Dashboard top cards: "Paying with" (PayPal linked), Telegram connected | "I linked PayPal once with PayPal Vault, and connected Telegram for approvals." |
| 0:50–1:20 | Claude Desktop: type "Restock my coffee and get the book I mentioned: The Pragmatic Programmer." Show the tool calls (allowance status, search, request_purchase ×2) and the answer | "Now my agent. This is Claude Desktop, connected to Allowance over MCP. I ask it to restock my coffee and buy a book. The coffee is within my rules, so it's paid immediately from my saved PayPal, with no checkout and no login. The book is thirty-two dollars, over my thirty-dollar 'ask me' threshold, so it's held." |
| 1:20–1:35 | Phone: Telegram message "Approve $32.00?" → tap **Approve** → message changes to "Paid $32.00" | "I get a Telegram message with Approve and Decline. One tap, and it's paid." |
| 1:35–1:50 | Back in Claude Desktop: "Did the book go through?" → get_purchase_status → approved | "Claude checks back and sees it went through. The agent never sees my PayPal account, and it can't approve itself." |
| 1:50–2:05 | Dashboard guided demo: click **Agent tries a mug** → Blocked with reason; click into the purchase → stepper + rule check + AI explanation | "Anything against my rules is blocked, and the agent gets a plain-English reason. Every purchase has a timeline: requested, rule check, approval, charged, and the store paid out through PayPal Payouts after a short refund window." |
| 2:05–2:13 | Purchases table: **Refund** the coffee (inline confirm) → Refunded | "Refunds are one tap, and a refund after a payout is clawed back from the merchant automatically." |
| 2:13–2:23 | `/store/analytics` (AG Studio): click **Blocked by rules** in the decision flow → every widget filters; switch to Edit layout, click the starter **"Why are purchases blocked?"** → the new chart scrolls into view with a highlight (cut the ~30 s wait in editing) | "The merchant gets live analytics built with AG Studio. Click a rule decision and the whole dashboard filters, and Studio's AI agents, running on our free Gemini setup, build new charts on request." |
| 2:23–2:33 | Agents page: **Revoke** Claude Desktop → in Claude ask "buy a decaf" → "This agent's access was revoked by its owner." | "And if an agent misbehaves, the kill switch revokes it on its very next request, even mid-conversation." |
| 2:33–2:43 | Landing "Built with" row, then the URL on screen | "Allowance is built on PayPal Vault, Orders, Payouts, Refunds, Webhooks and the Catalog API, with an MCP server and Gemini. Try the demo at the link below: no sign-up, sandbox only." |

**Shot list / B-roll (optional, if time allows)**
- Close-up of the rule check panel ("Decided by Allowance's deterministic checker, not by AI").
- `npm run test:db` output showing "5 parallel $30 vs $100 → 3 reserved" (2 seconds, for the technical judges).
- The Rules diff: "Kept your $40 per-order limit (not mentioned)."

**Before recording the AG Studio shot**
- Run a demo story first (coffee, book, mug, new store) so the dashboard has fresh data.
- Use the starter **"Why are purchases blocked?"**: 10/10 on the live site, median ~32 s (the other starter was also 10/10 but slower). Record it once, keep the take where the chart lands and highlights, and cut the wait.
- Avoid other heavy AI use just before recording: the free Gemini quota is shared.

**Tips**
- Keep the cursor still while speaking; zoom into key UI with your recorder's zoom (Screen Studio, or the macOS Screenshot toolbar + iMovie zoom).
- If a payout hasn't landed on camera yet, say "pays out after the refund window" and move on; the timeline shows the hold.
- Record the voice-over separately and lay it over the footage; it's easier to hit 2:40 that way.
