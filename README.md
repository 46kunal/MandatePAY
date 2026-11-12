# MandatePay

**Let an AI shop for you, and keep proof of what you asked.**

AI agents are starting to buy things for people. When one buys the wrong thing, nobody can prove what the buyer actually
allowed, so honest buyers and honest stores both lose disputes. MandatePay makes the buyer's intent a signed record that
travels with the payment: the buyer signs their limits, every cart is checked against them before PayPal is called, and if
the payment is disputed an AI analyst reads the signed record and recommends a fair response. A person approves everything
that goes to PayPal.

Built for the **"Build What's Next with PayPal and AI"** hackathon. PayPal sandbox only; no real money moves.

| | |
|---|---|
| **Live app** | https://mandate-pay.vercel.app |
| **Demo video (3 min)** | `<YouTube link>` |
| **For judges** | [docs/JUDGES.md](docs/JUDGES.md): a five-minute test path, how it meets the requirements, honest limits |
| **How it works** | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the flow, every PayPal API we use, every AI feature, the trust model |
| **Agent access (MCP)** | [docs/MCP.md](docs/MCP.md): any AI agent can shop for a buyer inside their signed mandate |
| **API reference** | [contracts/api.md](contracts/api.md): every route, with its schema in `contracts/schemas.ts` |
| **Submission text** | [docs/DEVPOST.md](docs/DEVPOST.md) |

## Contents

1. [How it works](#how-it-works)
2. [Features](#features)
3. [PayPal and AI: what is used where](#paypal-and-ai-what-is-used-where)
4. [Trust model and safety](#trust-model-and-safety)
5. [Tech stack](#tech-stack)
6. [Quick start](#quick-start)
7. [Demo data](#demo-data)
8. [Configuration](#configuration)
9. [Scripts](#scripts)
10. [Testing and analyst accuracy](#testing-and-analyst-accuracy)
11. [Deploying](#deploying)
12. [Project layout](#project-layout)
13. [Team](#team) · [Credits](#credits) · [License](#license)

## How it works

```
 Buyer says what they want          "white running trainers, size 10, under 110 USD, within two weeks"
        │
        ▼
 AI drafts structured limits        budget, product type, size and colour, delivery deadline
        │
        ▼
 Buyer SIGNS the mandate            Ed25519 JWS, with the buyer's own key (encrypted at rest)
        │
        ▼
 Agent shops the real catalog       the in-app agent, or any outside agent over MCP
        │
        ▼
 Cart guard checks the cart         hard limits are plain code; AI only settles the unsure matches
        │  (blocked carts never reach PayPal)
        ▼
 PayPal checkout                    PayPal account or card (3-D Secure); a receipt hash ties
        │                           mandate, cart and payment together
        ▼
 Something goes wrong?              buyer reports a problem → store replies or refunds
        │                           still unhappy → a real PayPal dispute arrives (webhook or poll)
        ▼
 AI analyst + code guardrails       reads the signed mandate, cart and payment; recommends a
        │                           response and cites the records it used
        ▼
 A person approves                  message with the evidence PDF, an offer, a refund, or accepting the claim
```

## Features

**For the buyer**
- **Mandates:** the request becomes limits (budget, items, size and colour, deadline), signed with the buyer's own key. Mandates can be revoked.
- **Voice or text input:** a full-screen *Listening* view for speech, and rotating "thinking" text while the AI works.
- **Shopping:** an AI agent shops the real catalog within the mandate, or the buyer browses (25 products from five seller brands in the demo store). Prices and details always come from the catalog, never from the model.
- **Payment:** PayPal Smart Buttons and Card Fields with 3-D Secure. The payer is checked against the buyer's linked PayPal account.
- **After the purchase:** order history with "Sold by" brands, and a **Report a problem** button that goes to the store before any PayPal dispute.
- **Agent access:** the buyer can create keys so an outside AI agent (over MCP) shops inside their signed mandates. Keys can be revoked.

**For the store (staff, admin, owner)**
- **Disputes:** PayPal disputes arrive by verified webhook and polling. Each has an AI recommendation, the evidence it relied on, a *Mandate vs cart* comparison, guardrail notes, and a downloadable PDF evidence pack.
- **Buyer reports:** a summary of what the records say, with one-click reply or refund.
- **Orders and refunds:** full or partial refunds. Refunds are re-read from PayPal first, so none is paid twice, including refunds made in the PayPal dashboard.
- **Products:** catalog with pictures, stock, delivery days, attributes and an optional seller brand.
- **Running the store:** roles (buyer, staff, owner, admin), team, settings and rules, audit log (append-only), CSV exports, and a **Results** page with the analyst's measured accuracy.

**For other AI agents**
- An **MCP server** (`/api/mcp`, JSON-RPC 2.0 over HTTP) with tools to list products, check a cart against the guard, and create a PayPal order. It can never sign a mandate, set a price, or pay: the buyer approves in PayPal.

## PayPal and AI: what is used where

**PayPal (sandbox)**

| Tool | What it does in MandatePay |
|---|---|
| Orders API v2 | Creates and captures the payment for a cart, with `PayPal-Request-Id` so a retry cannot charge twice |
| Smart Buttons and Card Fields | Pay by PayPal account or by card, with 3-D Secure when needed |
| Payments API (refunds) | Full and partial refunds, re-read from PayPal before every new one |
| Customer Disputes API | List and read disputes; send a message (with the evidence PDF); provide evidence; make an offer; accept a claim. Only actions PayPal allows at that dispute stage are offered |
| Webhooks (`verify-webhook-signature`) | Dispute and payment events are verified with PayPal before they are trusted |
| Log in with PayPal | Matches the paying PayPal account to the buyer who signed the mandate |

**AI**

| Where | What it does |
|---|---|
| Mandate drafting | Turns a sentence into structured limits the buyer reviews and signs |
| Shopping agent | Picks products from the catalog that fit the mandate, and says why |
| Fuzzy cart checks | Settles unsure matches (for example "white" vs "off-white"); hard limits stay in code |
| Dispute analyst | Recommends a response from the signed mandate, the cart and the payment, citing its evidence |
| MCP server | Lets outside agents (tested with Claude Code) shop inside a signed mandate |

Gemini is the default model. Claude and Grok are built behind the same interface (`LLM_PROVIDER`).

## Trust model and safety

- **The model only proposes; code decides.** Budgets, categories, quantities and deadlines are checked in code. The analyst's answer is validated against a strict schema and then against guardrails.
- **Guardrails that override the model:** an action PayPal does not allow at this stage, a second refund, a payer who is not the buyer, and prompt injection in the buyer's own text (flagged text always needs a person).
- **A person approves** every message, offer, refund or accepted claim before it goes to PayPal.
- **Signed records:** mandates are Ed25519 JWS. Each buyer's private key is encrypted at rest (AES-256-GCM). A receipt hash ties mandate, cart and payment together.
- **Agents are not trusted:** agent keys are stored as SHA-256 hashes, shown once, revocable, rate limited (60 calls per minute) and audited. Extra fields such as a price are rejected.
- **Sandbox only:** the app refuses to start against any PayPal host other than the sandbox.
- **Secrets:** never committed. `.env`, `.keys/` and the key directory are gitignored.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Postgres on Neon · Drizzle ORM · Better Auth · Zod contracts · `jose` (JWS) · `pdfkit` (evidence PDFs) · `@paypal/react-paypal-js` · Vercel · Docker (local Postgres).

## Quick start

Prerequisites: Node 20.9+, Docker.

```bash
npm run bootstrap     # installs dependencies, creates .env from .env.example
# edit .env: PayPal sandbox keys (docs/PAYPAL_SANDBOX_SETUP.md) and an LLM key (LLM_PROVIDER, LLM_API_KEY)
npm run db:up         # Postgres 16 on localhost:5434
npm run db:migrate
npm run seed:demo     # optional: the demo store (see below)
npm run dev
```

Check: open http://localhost:3000/api/health and expect `{"ok":true,"service":"mandatepay","database":"up"}` (503 when the
database is unreachable). `/merchant/settings` shows what is connected.

Nothing in the app is canned. To try the whole loop:

1. **Merchant, Products:** add the products you sell (or run the demo seed).
2. **Buyer, New purchase:** describe what you want; the AI drafts limits, and you sign them as a mandate.
3. **Let the agent shop:** it picks products that fit the mandate. The guard checks the cart.
4. **Pay** with the PayPal sandbox button or a sandbox test card (needs `NEXT_PUBLIC_PAYPAL_CLIENT_ID`).
5. **Disputes are real:** open one as the sandbox buyer in PayPal's Resolution Center, then use **Check PayPal for new disputes**. Run the AI analysis, approve an action, download the PDF evidence pack.

New sign-ups are always buyers. The owner promotes people to staff or admin under **Settings, Team**, or you can create one from
the command line with `npm run auth:create-user`.

## Demo data

`npm run seed:demo` builds **MandatePay Market**: five seller brands (Stride Lab, Loomhouse, Fieldnote, Brightwire, Tidewater),
25 products with linked free-licence photos, a small store team and a shopper. It is safe to run twice, and it never prints the
passwords it generates (they go to a gitignored file). Wiping and seeding a hosted database is described in
[docs/DEMO_DATA.md](docs/DEMO_DATA.md).

## Configuration

Every variable is explained in `.env.example`. The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (Neon's pooled string on Vercel) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_BASE_URL` | PayPal sandbox app |
| `PAYPAL_WEBHOOK_ID` | Webhook verification (polling also works without it) |
| `NEXT_PUBLIC_PAYPAL_LOGIN_ENABLED` | Switches on Log in with PayPal |
| `BETTER_AUTH_SECRET`, `APP_BASE_URL` | Sign-in sessions |
| `MANDATE_BUYER_PRIVATE_KEY`, `MANDATE_AGENT_PRIVATE_KEY`, `MANDATE_KEY_ENCRYPTION_KEY` | Mandate signing (hosted); `npm run keys:export` creates them |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | The AI model (`gemini`, `anthropic` or `grok`) |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js development, build and production server |
| `npm run typecheck` | TypeScript check |
| `npm test` | All unit and route tests (339) |
| `npm run db:up` / `db:down` / `db:reset` | Local Postgres in Docker |
| `npm run db:generate` / `db:migrate` | Create and apply Drizzle migrations (15 so far) |
| `npm run eval` | Score the dispute analyst on 28 labelled cases |
| `npm run seed:demo` | Build the demo store |
| `npm run keys:export` | Generate hosted signing keys |
| `npm run auth:create-user` | Create a staff, owner or admin account |

## Testing and analyst accuracy

`npm test` runs 339 tests: the guard, the mandate signing, refunds, the PayPal clients, the webhook flow, route security, the
MCP server and the analyst's guardrails.

`npm run eval` runs the case analyst over 28 labelled disputes in `eval/cases.json`: not received, not as described,
unauthorised, credit not processed, high value, restricted actions, three prompt-injection cases, payment-fact cases (does the
buyer's own PayPal account match), the inquiry stage where PayPal offers no evidence upload, and the tricky "within the mandate
but wrong product" case. A case passes only if the fault, the action and (where labelled) `needs_human` are all right.

| Analyst | Fault | Action | needs_human | Overall |
|---|---|---|---|---|
| Claude (`LLM_PROVIDER=anthropic`) | built and unit-tested, not benchmarked | | | |
| Grok (`LLM_PROVIDER=grok`) | built and unit-tested, not benchmarked | | | |
| Gemini 3.1 Flash-Lite (`LLM_PROVIDER=gemini`, free tier, run 2026-11-10, 28 cases) | 82% (23/28) | 86% (24/28) | 89% (8/9) | **79% (22/28)** |

The analyst went from 36% (first 25-case set, before the fault-to-action policy) to 79% by changing the policy and prompt and
measuring each change; a prompt change that biased the model toward send-message scored 68% and was reverted. These are
real-model numbers on hand-labelled cases and move by a few points between runs. The prompt-injection guardrail is plain code and
does not depend on the model.

## Deploying

Hosted on Vercel with Neon Postgres. [docs/DEPLOY.md](docs/DEPLOY.md) has the steps. Migrations run on every deploy
(`vercel-build`). Point an uptime monitor at `/api/health`. The app only talks to PayPal's sandbox host.

## Project layout

```
app/        Next.js pages (buyer, merchant, landing) and API routes (/api/...)
contracts/  shared Zod schemas and the API table (api.md)
db/         Drizzle schema, client and migrations
lib/        server modules: paypal, mandate, analyst, agent, ai, catalog, reports, mcp, auth
eval/       the labelled dispute set and the scoring script
scripts/    seed, key export, user creation, PayPal webhook registration
docs/       judges' guide, architecture, MCP, deployment, roles, demo data, PayPal sandbox setup
```

## Team

- **Kunal Yawatkar:** PayPal integration, API contracts, MCP server, deployment, documentation and demo.
- **Yash Rajput:** mandate drafting and signing, the cart guard, the dispute analyst and its evaluation set.
- **Shreyash Gupta:** database schema and the buyer and store interfaces.

## Credits

- Product photos in the demo store are from [Pexels](https://www.pexels.com/license/) (free licence), linked and not stored in
  this repository. The photo ids are listed in [docs/DEMO_DATA.md](docs/DEMO_DATA.md).
- The interface motion follows the open-source "unslop" design skill by Damir Sokolovsky (CC BY 4.0).

## License

MIT
