# For judges

**Live app:** https://mandate-pay.vercel.app  ·  **Code:** this repository  ·  **How it works:** [ARCHITECTURE.md](ARCHITECTURE.md)

## The one-paragraph version

When an AI agent buys something for you, nobody can prove what you actually allowed. MandatePay signs your limits before
anything is bought, checks every cart against them, pays through PayPal, and, if there is a dispute, gives an AI analyst
the signed record so it can recommend a fair response. A person approves every response.

## How it meets the requirements

| Requirement | Where to see it |
|---|---|
| **Meaningful PayPal use** | Orders v2 and Card Fields checkout, refunds, the Customer Disputes API (message, evidence, offer, accept), verified webhooks, Log in with PayPal. Full map in [ARCHITECTURE.md](ARCHITECTURE.md#where-paypal-is-used). |
| **Meaningful AI use** | Mandate drafting, a shopping agent, AI-assisted cart checks, and a dispute analyst with code guardrails. Scored on 28 labelled disputes (79% on every check at once). See [Where AI is used](ARCHITECTURE.md#where-ai-is-used). |
| **Working prototype** | Deployed and live; real PayPal sandbox orders and real sandbox disputes, no canned data. 324 automated tests, CI on every push. |
| **Agents** | An MCP server (`/api/mcp`) lets any AI agent shop under a buyer's signed mandate: [MCP.md](MCP.md). |
| **Documented** | This guide, ARCHITECTURE.md, `contracts/api.md` (every route), `.env.example` (every variable), `docs/DEPLOY.md`. |

## Try it in about five minutes

You need a **PayPal sandbox buyer account** (a "Personal" account from developer.paypal.com → Testing Tools → Sandbox
Accounts) to pay and to open a dispute. Card payments work with PayPal's sandbox test card `4111 1111 1111 1111`, any
future expiry, any 3-digit code.

**As a buyer**
1. Open the site, click **Get started**, create an account.
2. **New purchase.** Type (or use the microphone for) something like *"white running trainers, size 10, under 110 USD, delivered within two weeks"*. The AI turns it into limits. Review them and **sign the mandate**.
3. Either **let the agent pick** or browse the store and add items yourself. Watch the **mandate check** on the cart: try adding something that breaks a limit and it is blocked before PayPal is called.
4. Pay with PayPal or a card.
5. Optional: on **My orders**, **Report a problem**. The store can refund you directly with no PayPal dispute.

**As the store** (sign in with the store owner account; the owner creates it with `npm run auth:create-user`)
1. **Disputes → Check PayPal for new disputes.** To create one: as the sandbox buyer, open PayPal's Resolution Center on the sandbox site and raise "item not as described" on the order (do not click *Escalate*, PayPal then takes the case over).
2. Open the dispute. The **Next step** box shows what PayPal currently allows. The AI has already read the signed mandate, the cart and the payment, and shows a recommendation with the evidence it relied on.
3. Check **Mandate vs cart** and the **reasoning**, then approve the action. It goes to PayPal; the evidence PDF can be downloaded from the same page.
4. **Orders → Refund** for a partial or full refund (it will not refund twice, even after a refund made in the PayPal dashboard).
5. **Results** shows disputes handled, how often people kept the AI's advice, the guard's activity and the analyst's test-set accuracy.

## Connect your own AI agent (MCP)

MandatePay is also an MCP server. As the buyer, open **Account → Agent access → Create a key**, then, for example:

```bash
claude mcp add --transport http mandatepay https://mandate-pay.vercel.app/api/mcp --header "Authorization: Bearer <key>"
```

Ask the agent to shop within your mandate. It can list mandates and products, test baskets against the guard
(`check_cart`), and create the PayPal order (`place_order`), but it gets only an approval link: it cannot sign a mandate or
pay. Details in [MCP.md](MCP.md).

## Credentials for testing

Put these in the Devpost "testing instructions" field rather than in the repository:

```
Store owner:  <email>  /  <password>
Sandbox buyer (PayPal): <sandbox personal account email>  /  <password>
```

## Honest limits

- It runs on the PayPal **sandbox** only. Going live needs PayPal's live approval.
- The analyst is not perfect (79% on all checks at once), which is why code rules override unsafe answers and a person approves everything sent.
- PayPal's sandbox dispute list can lag a few minutes; the Disputes page auto-checks every minute and has a fetch-by-id box.

## Run it yourself

```bash
npm run bootstrap && npm run db:up && npm run db:migrate && npm run dev
npm test        # 324 tests, no network or keys needed
npm run eval    # scores the analyst (needs an LLM key in .env)
```
