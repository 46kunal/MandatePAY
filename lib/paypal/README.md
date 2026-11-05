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

## Not yet verified against the sandbox

The dispute field names follow PayPal's docs but have not been checked against a real sandbox dispute. Day 2 task:
confirm `disputed_transactions[].seller_transaction_id` equals `orders.capture_id`, and record which links appear at
each stage.

## Tests

```bash
npx tsx --test lib/paypal/paypal.test.ts
```
