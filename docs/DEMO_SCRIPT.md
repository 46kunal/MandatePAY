# Three-minute demo video script

Record the live site at 1440 wide, with a sandbox buyer already created and a sandbox dispute ready to raise (see
[JUDGES.md](JUDGES.md)). Keep each beat short; the product explains itself on screen.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Landing page, headline and the mandate typing, the stamp landing | "AI agents are starting to buy things for us. When one buys the wrong thing, nobody can prove what the buyer allowed. MandatePay fixes that." |
| 0:15 | New purchase. Speak or type the request. The limits appear. Sign the mandate | "The buyer says what they want. AI turns it into limits, and the buyer signs them with their own key." |
| 0:40 | Shop page: let the agent pick; then add an item that breaks a limit and show the guard blocking it | "Every cart is checked against the signed mandate before PayPal is touched. Hard limits are code; the AI settles only the unsure matches." |
| 1:05 | Checkout: pay with PayPal or the card fields (test card) | "Payment goes through PayPal Orders and Card Fields. A receipt hash ties the mandate, the cart and the payment together." |
| 1:25 | PayPal sandbox Resolution Center: the buyer raises "item not as described" | "Now the buyer disputes it. This is a real PayPal sandbox dispute." |
| 1:40 | Store: the dispute arrives (webhook or the auto-check). Open it: the Next step box, the AI recommendation, evidence points, **Mandate vs cart** | "It arrives by verified webhook. The AI reads the signed mandate, the cart and the payment and recommends a response, citing the records it used." |
| 2:10 | Point at the guardrail note (for example already refunded, or a person is needed). Approve the action. Show the evidence PDF | "Code rules override anything unsafe, such as a second refund or a different payer. A person approves. The evidence goes to PayPal as a PDF." |
| 2:35 | Orders: refund (partial). Results page with the analyst's scores | "Refunds are read back from PayPal so none is paid twice. And the analyst is measured: 79% on 28 labelled disputes, with a person always deciding." |
| 2:55 | Landing page "Built on PayPal and AI" | "PayPal for the money and the disputes, AI for the intent and the judgement. MandatePay." |

## Tips

- Do not click **Escalate issue to PayPal** on the sandbox dispute: PayPal then takes the case over and the store cannot respond.
- Raise the dispute before recording and let it appear in the store; PayPal's list can lag a few minutes.
- Use the owner account for the store part so Refund and Settings are visible.
