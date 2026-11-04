# Roles and rules

Deadline: Nov 12, 2026 (confirm the exact time on Devpost).

| Person | Owns | Folders |
|---|---|---|
| Orchestrator | contracts, scope, integration, README, demo video, submission | `contracts/`, `docs/`, root config |
| A | PayPal integration, orders, disputes, webhooks/polling, ledger | `lib/paypal/`, `app/api/orders`, `app/api/webhooks`, `app/api/disputes`, `app/api/cases` (except analyse) |
| B | Mandates, signing, cart guard, AI analyst, eval | `lib/mandate/`, `lib/guard/`, `lib/ai/`, `app/api/mandates`, `app/api/carts`, `app/api/cases/[id]/analyse`, `eval/` |
| C | Buyer and merchant UI, seed data, demo reset, Docker polish | `app/buyer/`, `app/merchant/`, `scripts/seed.ts`, `app/api/demo/` |

## Rules
1. Work on a branch, open a PR, orchestrator merges. Small PRs.
2. Edit only your folders. Cross-folder needs go through the orchestrator.
3. Contracts change only via PR touching `contracts/schemas.ts` and `contracts/api.md`.
4. Daily standup (10 min) and an evening merge window.
5. Never commit secrets. Sandbox only.

## Early risks
- Day 2 (A): confirm the dispute's `seller_transaction_id` matches our stored capture ID. If not, link via another field.
- Sandbox disputes must be created manually in the Resolution Center as a personal sandbox account.

## Cut list (drop in this order if time runs short)
1. Live webhooks (keep polling)
2. PDF evidence pack
3. LLM fuzzy matching in the guard (keep deterministic rules)
4. Eval set size
