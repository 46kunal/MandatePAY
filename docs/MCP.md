# MandatePay as an MCP server

Any AI agent that speaks the [Model Context Protocol](https://modelcontextprotocol.io) can shop for a buyer through
MandatePay, **inside the spending limits the buyer already signed**. The agent brings the intelligence; MandatePay brings
the guard, the PayPal order and the record.

## What an agent can and cannot do

| It can | It cannot |
|---|---|
| List the buyer's active mandates and read their limits | Create or sign a mandate: only the buyer does that, in the app |
| Browse the store catalog (names, prices, delivery, availability) | Set or change a price: prices always come from the catalog |
| Test a basket against a mandate and read why it is allowed, blocked, or needs approval | Get around a limit: the same cart guard as the buyer's own checkout runs on every basket |
| Create the PayPal order for a basket that fits | **Pay**: it gets a PayPal approval link, and the buyer opens it and approves the payment |
| Check whether an order was approved and paid | See any other buyer's mandates or orders |

An order over the buyer's approval limit comes back as "needs the buyer's approval": the agent cannot approve it for them.

## Connect an agent

1. Sign in to MandatePay, open **Account**, and under **Agent access** click **Create a key**. Copy the key; it is shown once and only its hash is stored. You can revoke it at any time, and the agent is cut off at once.
2. Point the agent at the endpoint with the key as a bearer token.

Claude Code:

```bash
claude mcp add --transport http mandatepay https://mandate-pay.vercel.app/api/mcp --header "Authorization: Bearer mpk_..."
```

Any other MCP client: the server URL is `https://mandate-pay.vercel.app/api/mcp` (Streamable HTTP, JSON replies) and the
header is `Authorization: Bearer mpk_...`.

Then ask the agent something like *"Using MandatePay, find white running trainers in my size 10 within my mandate and
set up the order."* It will call the tools below and hand you a PayPal link.

## The tools

| Tool | Arguments | Returns |
|---|---|---|
| `list_mandates` | none | Active mandates: id, the buyer's words, the limits (budget, categories, required attributes, deadline), expiry |
| `list_products` | `currency?` | The store name and what can be bought: SKU, name, price, attributes, delivery days, availability |
| `check_cart` | `mandate_id`, `items: [{ sku, quantity }]` | `allow`, `block` or `escalate`, the total, and one line per rule (`max_total`, `categories`, `required_attributes`, `deadline`, `approval_threshold`) |
| `place_order` | `mandate_id`, `items` | `created` with `order_id` and `approve_url`, or `needs_buyer_approval`, or an error that says which rule blocked it |
| `get_order` | `order_id` | `awaiting_buyer_approval` or `paid`, with the total and items |

Arguments are strict: an extra field (for example a `unit_price`) is refused, so an agent cannot name its own price.

## How it is kept safe

- **Keys:** 24 random bytes, shown once, stored only as a SHA-256 hash; at most five active per buyer; revocable; the last-used time is shown so a forgotten key stands out.
- **Scope:** every tool checks that the mandate or order belongs to the key's buyer. Someone else's reads as "not found".
- **The guard is shared:** `check_cart` and `place_order` call the same `checkCartById` and `placeOrder` as the buyer's own page, so the budget, category, attribute, deadline and approval rules cannot be skipped.
- **No self-approval:** `place_order` always passes `buyerApproved: false`.
- **Limits and logs:** 60 calls a minute per buyer. The audit log records which tool was called and with which key, never what it was given.
- **Errors:** a refusal is returned to the agent as a plain-language tool error it can act on; an internal failure is reported in general words only.

## Under the hood

`app/api/mcp/route.ts` (the endpoint), `lib/mcp/protocol.ts` (JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call`),
`lib/mcp/tools.ts` (the five tools, with injected dependencies so they are unit-tested), `lib/mcp/wiring.ts` (the real
database, catalog, guard and PayPal), `lib/mcp/keys.ts` (agent keys). Tests: `lib/mcp.test.ts`.

Not offered: server-sent event streaming (clients POST), OAuth for remote connectors (a bearer key is used), and any tool
that signs a mandate or captures a payment. Those are deliberate.
