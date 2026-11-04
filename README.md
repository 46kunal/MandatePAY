# MandatePay

Every AI purchase on PayPal comes with proof of what the buyer asked for. A signed mandate (AP2-style, not interoperable) is stored in the PayPal order, a cart guard checks the cart against it, and an AI case analyst uses it to resolve PayPal disputes fairly.

Built for the PayPal "Build What's Next with PayPal and AI" hackathon. Sandbox only.

## Quick start

Prerequisites: Node 20.9+, Docker.

```bash
npm run bootstrap     # installs dependencies, creates .env from .env.example
# edit .env: add PayPal sandbox client id and secret (see docs/PAYPAL_SANDBOX_SETUP.md)
npm run db:up         # Postgres 16 on localhost:5433
npm run db:generate   # first time only (orchestrator), commit the migration
npm run db:migrate
npm run dev
```

Check: open http://localhost:3000/api/health, expect `{"ok":true,"service":"mandatepay"}`.

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
