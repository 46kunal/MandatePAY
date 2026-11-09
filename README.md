# MandatePay

Every AI purchase on PayPal comes with proof of what the buyer asked for. A signed mandate (AP2-style, not interoperable) is stored in the PayPal order, a cart guard checks the cart against it, and an AI case analyst uses it to resolve PayPal disputes fairly.

Built for the PayPal "Build What's Next with PayPal and AI" hackathon. Sandbox only.

## Quick start

Prerequisites: Node 20.9+, Docker.

```bash
npm run bootstrap     # installs dependencies, creates .env from .env.example
# edit .env: PayPal sandbox keys (docs/PAYPAL_SANDBOX_SETUP.md) and an LLM key (LLM_PROVIDER, LLM_API_KEY)
npm run db:up         # Postgres 16 on localhost:5434
npm run db:migrate
npm run dev
```

Check: open http://localhost:3000/api/health, expect `{"ok":true,"service":"mandatepay"}`, and /merchant/settings
shows what is connected.

Nothing in the app is canned. To use it:

1. **Merchant → Products:** add the products you sell (price, stock, attributes such as colour and size, delivery days).
2. **Buyer:** describe what you want; the AI drafts limits, you sign them as a mandate.
3. **Ask the agent to shop:** it picks products from your catalog that fit the mandate and says why. Prices and
   details come from the catalog, never from the model. The guard checks the cart; you can change it.
4. **Pay** with the PayPal sandbox button (needs `NEXT_PUBLIC_PAYPAL_CLIENT_ID`).
5. **Disputes** are real: open one as the sandbox buyer in PayPal's Resolution Center, then **Poll disputes**. Run the
   AI analysis, approve an action, download the PDF evidence pack.

## Analyst accuracy

`npm run eval` runs the case analyst over 25 labelled disputes in `eval/cases.json` (not received, not as described, unauthorised, credit not processed, high value, restricted actions, and three prompt-injection cases, plus the tricky "within the mandate but wrong product" case). A case passes only if the fault, the action and (where labelled) `needs_human` are all right.

| Analyst | Fault | Action | needs_human | Overall |
|---|---|---|---|---|
| Claude (`LLM_PROVIDER=anthropic`) | not yet run | not yet run | not yet run | not yet run |
| Grok (`LLM_PROVIDER=grok`) | not yet run | not yet run | not yet run | not yet run |
| Gemini 3.1 Flash-Lite (`LLM_PROVIDER=gemini`, free tier, run 2026-11-09) | 68% (17/25) | 52% (13/25) | 100% (7/7) | **36% (9/25)**, 3 of the 25 errored on provider timeouts or overload |

These are real-model numbers on 25 hand-labelled cases; there is no offline analyst to compare against. Run `npm run eval` (needs `LLM_PROVIDER` and `LLM_API_KEY` in `.env`; set `EVAL_DELAY_MS=4000` on a free tier) and replace a row. The prompt-injection guardrail (flagged text always needs a human) is plain code and does not depend on the model.

## Layout

- `contracts/` shared Zod schemas and the API table
- `db/` Drizzle schema and client
- `lib/` server modules (see `lib/README.md`)
- `app/` Next.js UI and API routes
- `docs/` roles and PayPal sandbox setup
- `eval/` analyst evaluation set

## Orchestrator Day 1 checklist

- [ ] Create the public GitHub repo, push, confirm LICENSE (MIT) shows
- [ ] Turn on branch protection for `main`
- [ ] Create the PayPal sandbox app, share credentials privately
- [ ] Run `npm run bootstrap`, commit `package.json` and the lockfile
- [ ] Invite A, B, C
- [ ] 15-minute walkthrough of `contracts/`

## License

MIT
