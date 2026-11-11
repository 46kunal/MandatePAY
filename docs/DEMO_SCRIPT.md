# Three-minute demo video script

One story, told once: **an AI agent shops inside signed limits, the buyer approves the payment in PayPal, and a dispute is
settled from the signed record.** Everything else is a few seconds of proof or is left to the docs.

Record the live site at 1440 wide. Prepare first (see "Before you record").

| Time | On screen | Say |
|---|---|---|
| 0:00 | Landing page: the headline, the mandate typing, the stamp landing | "AI agents are starting to buy things for us. When one buys the wrong thing, nobody can prove what the buyer allowed. MandatePay fixes that, with PayPal and AI." |
| 0:15 | New purchase: tap the microphone, say the request, the **Listening** screen; the limits appear; sign the mandate | "The buyer says what they want. AI turns it into limits, and the buyer signs them with their own key." |
| 0:35 | Shop page: add an item that breaks a limit; the guard blocks it, with the reason | "Every cart is checked against the signed mandate before PayPal is touched. Hard limits are code; AI settles only the unsure matches." |
| 0:50 | **The agent moment.** Claude Code (or any MCP agent): "use MandatePay to set up white running trainers in my size." It calls `check_cart` (one basket blocked), then `place_order`, and prints the PayPal link | "MandatePay is also an MCP server. Any outside agent can shop for me, but only inside my signed mandate. It can't sign one, and it can't pay." |
| 1:20 | Open the link: PayPal sandbox, approve the payment. Flash the card fields (5 seconds) | "It only gets an approval link. I approve in PayPal, by PayPal account or card." |
| 1:40 | PayPal Resolution Center: the buyer raises "item not as described" (prepared, 5 seconds) | "Now the buyer disputes it. This is a real PayPal sandbox dispute." |
| 1:50 | Store: the dispute is there; open it: Next step, the AI recommendation with its evidence, **Mandate vs cart** | "It arrives by verified webhook. The AI reads the signed mandate, the cart and the payment, and recommends a response, citing the records it used." |
| 2:15 | The guardrail note (for example already refunded), approve, the evidence PDF | "Code rules override anything unsafe, like a second refund or a different payer. A person approves, and the evidence goes to PayPal as a PDF." |
| 2:35 | Orders: partial refund (3 seconds). Results page (3 seconds) | "Refunds are read back from PayPal so none is paid twice, and the analyst is measured: 79% on 28 labelled disputes, with a person always deciding." |
| 2:50 | Landing page, "Built on PayPal and AI" | "PayPal for the money and the disputes, AI for the intent and the judgement. MandatePay." |

## Before you record

- **Buyer:** a signed mandate for white trainers, size 10, USD 110, and an agent key created under Account, Agent access.
- **Agent:** Claude Code (or another MCP client) already connected with the `claude mcp add` command from the Account page. Do a dry run so the first call is not slow.
- **Dispute:** raise "item not as described" on a paid sandbox order beforehand, let it appear in the store, and let the AI analysis finish so the page is full. Do not click Escalate: PayPal then takes the case over.
- **Pre-record the slow parts** (the agent thinking, PayPal's pages) and cut or speed up the waits; the voice-over carries the story.
- Do it as the owner account for the store part so Refund is visible; close other tabs; 1080p; add captions.

## What to leave out of the video (it is all in the docs)

Roles and the team page, settings, the audit log, webhook diagnostics, the disputes auto-check, buyer problem reports,
product pictures, the landing page animation details. A one-line mention in the voice-over is enough; the judges' guide
and architecture notes carry the rest.

## If you are running long

Cut in this order: the Results page, the refund, the card fields, the shop-page guard block. Keep the agent moment, the
approval in PayPal, and the dispute with its AI recommendation: those are the project.
