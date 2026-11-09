# lib/paypal (owner: A)

PayPal sandbox integration: OAuth, Orders v2, Disputes, webhook verification. Sandbox only: the client refuses any
host that is not `*sandbox*`, `localhost` or `127.0.0.1`.

```ts
import { getPayPalClient, createOrder, captureOrder, showDispute, toDisputeSummary } from '@/lib/paypal';

const client = getPayPalClient();                       // shared token cache, built from env
const order = await createOrder(client, { mandateId, cartId, cart });   // custom_id = mandate, invoice_id = cart
const cap = await captureOrder(client, order.paypalOrderId);            // cap.captureId joins disputes to orders
const summary = toDisputeSummary(await showDispute(client, disputeId)); // input for B's analyst
```

## Environment

`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_BASE_URL` (default sandbox), `PAYPAL_WEBHOOK_ID` (optional),
`APP_BASE_URL`. Missing credentials throw `PayPalConfigError` (route: 500).

## Behaviour

- **Token cache:** one token, refreshed 60 s before expiry; concurrent callers share a single refresh; one retry on 401.
- **Idempotency:** every POST carries `PayPal-Request-Id`. Orders use `order-<cart_id>`, captures `capture-<order_id>`,
  so a double click or retry cannot create or capture twice. Without an explicit id a random UUID is used.
- **Errors:** `PayPalError` has `status` (0 = network), `paypalName`, `debugId`. Routes return 502.
- **Money:** integer minor units internally (`toMinor`, `fromMinor`, `cartTotalMinor`); never floats.
- **Disputes:** `toDisputeSummary` builds `DisputeSummary`. `allowed_actions` comes from PayPal's HATEOAS links (plus
  `allowed_response_options` as a fallback); `NO_ACTION` is always allowed.

## Verified against the sandbox (2026-11-09)

A real buyer dispute (`PP-R-...`, reason `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`) on a captured USD 89.00 order:

- `disputed_transactions[0].seller_transaction_id` **equals `orders.capture_id`**. `buyer_transaction_id` does not.
  The same object also carries `custom` (our mandate id) and `invoice_number` (our cart id), usable as a fallback link.
- `dispute_amount`, `reason`, `status`, `dispute_life_cycle_stage` (`INQUIRY`), `messages[].posted_by/content/time_posted`
  match the mapper. Extra fields seen: `dispute_state`, `dispute_channel` (`INTERNAL`), `offer.buyer_requested_amount`,
  `refund_details.allowed_refund_amount`, `evidences[]` (the buyer's text is also here), `fund_movements`.
- A new dispute can take a few minutes to appear in `GET /v1/customer/disputes`; poll again.
- At `INQUIRY` / `UNDER_REVIEW` / `UNDER_PAYPAL_REVIEW` the response has **only a `self` link and no
  `allowed_response_options`**, so `deriveAllowedActions` correctly yields `['NO_ACTION']` and `POST /api/cases/:id/act`
  returns 422 for any PayPal call. Links for actionable stages (for example `WAITING_FOR_SELLER_RESPONSE`) have not been seen yet.

## Tests

```bash
npm test   # all lib/**/*.test.ts
```
