# MandatePay

Every AI purchase on PayPal comes with proof of what the buyer asked for. A signed mandate (AP2-style, not interoperable) is stored in the PayPal order, a cart guard checks the cart against it, and an AI case analyst uses it to resolve PayPal disputes fairly.

Built for the PayPal "Build What's Next with PayPal and AI" hackathon. Sandbox only.

## Quick start

Prerequisites: Node 20.9+, Docker.

```bash
npm run bootstrap     # installs dependencies, creates .env from .env.example
# edit .env: add PayPal sandbox client id and secret (see docs/PAYPAL_SANDBOX_SETUP.md)
npm run db:up         # Postgres 16 on localhost:5434
npm run db:generate   # first time only (orchestrator), commit the migration
npm run db:migrate
npm run dev
```

Check: open http://localhost:3000/api/health, expect `{"ok":true,"service":"mandatepay"}`.

## Analyst accuracy

`npm run eval` runs the case analyst over 25 labelled disputes in `eval/cases.json` (not received, not as described, unauthorised, credit not processed, high value, restricted actions, and three prompt-injection cases, plus the tricky "within the mandate but wrong product" case). A case passes only if the fault, the action and (where labelled) `needs_human` are all right.

| Analyst | Fault | Action | needs_human | Overall |
|---|---|---|---|---|
| Offline mock (`LLM_PROVIDER=mock`) | 100% (25/25) | 100% (25/25) | 100% (8/8) | **100% (25/25)** |
| Claude (`LLM_PROVIDER=anthropic`) | not yet run | not yet run | not yet run | not yet run |
| Grok (`LLM_PROVIDER=grok`) | not yet run | not yet run | not yet run | not yet run |
| Gemini 3.1 Flash-Lite (`LLM_PROVIDER=gemini`, free tier, run 2026-11-09) | 68% (17/25) | 52% (13/25) | 100% (7/7) | **36% (9/25)**, 3 of the 25 errored on provider timeouts or overload |

**Read the mock row with care.** The mock is a small keyword reader that I tuned against these same 25 cases (before tuning it scored 64%), so 100% shows the pipeline and guardrails work end to end, not that the analyst is accurate on unseen disputes. The real accuracy number is the Claude row: run `LLM_PROVIDER=anthropic LLM_API_KEY=... npm run eval` and replace it. The prompt-injection guardrail (flagged text always needs a human) is plain code and does not depend on either model.

## Layout

- `contracts/` shared Zod schemas and the API table
- `db/` Drizzle schema and client
- `lib/` server modules (see `lib/README.md`)
- `app/` Next.js UI and API routes (unbuilt routes return 501)
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
