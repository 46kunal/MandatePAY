# PayPal sandbox setup

Dashboard click-paths change; treat these as a guide and adjust.

1. Sign in at developer.paypal.com with a PayPal account.
2. Go to Sandbox, Apps & Credentials. Create an app (type: Merchant) tied to a sandbox business account.
3. Copy the Client ID and Secret into `.env` as `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET`. Never commit them.
4. Sandbox accounts: open Sandbox, Accounts. You need one business (merchant) and one personal (buyer) account. Use View/Edit Account to get the buyer's login.
5. Check that the Customer disputes add-on is enabled for the business account (Features, Add-on services).
6. Webhooks (optional): needs a public URL, so run `ngrok http 3000`. Add webhook `https://<ngrok-host>/api/webhooks/paypal` for `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.UPDATED`, `CUSTOMER.DISPUTE.RESOLVED`. Put the Webhook ID in `PAYPAL_WEBHOOK_ID`.
7. Create a test dispute manually: pay with the buyer account, then in a separate browser session sign in as the buyer in the sandbox Resolution Center and open a dispute on the transaction.
8. In the app, click "poll disputes" to pull it in (this works without webhooks).
