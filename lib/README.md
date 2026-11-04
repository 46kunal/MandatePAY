# lib/ module ownership

| Folder | Owner | Contents |
|---|---|---|
| `lib/paypal/` | A | OAuth token cache, Orders v2, Disputes API, webhook verification |
| `lib/mandate/` | B | Ed25519 key handling, sign/verify (JWS via `jose`), receipt hash |
| `lib/guard/` | B | Deterministic cart rules, LLM only for fuzzy matches |
| `lib/ai/` | B | LLM client, prompts, strict JSON tool schemas |
| `lib/config.ts`, `lib/http.ts` | Orchestrator | env validation, API error helpers |

Only edit your own folder. Need a change in someone else's? Open a PR or ask in standup.
