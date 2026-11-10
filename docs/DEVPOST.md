# Devpost submission text (ready to paste)

## Name
MandatePay

## Tagline
Let an AI shop for you, and keep proof of what you asked.

## Inspiration
AI agents are starting to buy things for people. That raises a question nobody can answer today: when an agent buys the
wrong thing, who decides it was wrong? The buyer says they never asked for it, the store says they did, and PayPal has to
guess. Honest people lose either way. We wanted the buyer's intent to be a record that travels with the payment.

## What it does
- A buyer says what they want ("white trainers, size 10, under $110, within two weeks"). AI turns it into structured limits, and the buyer **signs them as a mandate** with their own key.
- A shopping agent picks real products inside those limits, or the buyer browses and adds items. A **cart guard** checks every cart against the mandate before PayPal is called; unsure matches are settled by AI, hard limits by plain code.
- The buyer pays with **PayPal or a card** (PayPal Card Fields, with 3-D Secure when needed). A receipt hash ties the mandate, cart and payment together.
- If something goes wrong, the buyer can **report a problem** and the store can refund directly. If it becomes a **PayPal dispute**, it arrives by webhook, and an **AI analyst** reads the signed mandate, the cart and the payment (including whether the buyer's own PayPal account paid) and recommends a response with the evidence it relied on.
- Code rules override anything unsafe (an action PayPal does not allow, a second refund, a different payer, prompt injection in the buyer's text). **A person approves** everything before it goes to PayPal: a message with the evidence PDF, an offer, a refund, or accepting the claim.

## How we built it
Next.js 16 and TypeScript, Postgres on Neon, deployed on Vercel. **PayPal:** Orders v2, Card Fields and Smart Buttons,
Payments refunds, the Customer Disputes API (list, show, send message, provide evidence, make offer, accept claim),
verified webhooks, and Log in with PayPal for payer matching. **AI:** Gemini (with Claude and Grok behind the same
interface) for mandate drafting, the shopping agent, fuzzy cart checks and the dispute analyst. Mandates are Ed25519 JWS
with a per-buyer encrypted key. Every API has a Zod contract, 324 tests run in CI, and the analyst is scored on a labelled
set of 28 disputes.

## Challenges we ran into
- PayPal only lets a seller take certain actions at each dispute stage, so the analyst's recommendation is reconciled with the actions PayPal currently offers (for example, at the inquiry stage the evidence goes as a message, not an upload).
- A payment can be refunded outside the app, so the app re-reads refunds from PayPal and never refunds twice.
- Keeping the model honest: it only proposes, code decides what is allowed, and the buyer's own words are treated as untrusted data.
- Raising the analyst from 36% (our first 25-case set) to 79% (the current 28-case set) by changing the policy and the prompt, and measuring each change instead of guessing.

## Accomplishments we're proud of
A full loop with no canned data: real sandbox orders, real sandbox disputes, real refunds. An analyst that is measured, with
guardrails that do not depend on the model. A buyer experience with voice input and a store experience built around what needs a person.

## What we learned
In agentic commerce the hard part is not letting the agent buy, it is being able to explain afterwards why it was allowed to.
A signed, checkable record makes that cheap.

## What's next
Email and push notifications for dispute deadlines, a second analyst pass for the unclear cases, an MCP server so any AI
agent can shop under a MandatePay mandate, and the move from sandbox to PayPal live.

## Built with
Next.js, TypeScript, PostgreSQL, Drizzle, PayPal Orders and Disputes APIs, PayPal Card Fields, Log in with PayPal, Gemini, Claude, Grok, Vercel, Neon

## Try it
https://mandate-pay.vercel.app  ·  testing steps in `docs/JUDGES.md`
