# Deploying MandatePay (Vercel + Neon)

Local development keeps using Docker Postgres. Hosted environments use Neon for the database and Vercel for the app.
Every step below that creates an account or copies a secret is done by a person, not by a script in this repo.

## 1. Database on Neon

1. Create a Neon project (free tier) in the region nearest your users.
2. Create two branches: `prod` (the default) and `dev` (for Vercel preview deployments).
3. For each branch, copy the **pooled** connection string (the host contains `-pooler`). It looks like
   `postgres://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require`.
4. Create the tables from your machine, once per branch:

   ```bash
   DATABASE_URL="<neon pooled url>" npm run db:migrate
   ```

   After this, every Vercel deploy runs `drizzle-kit migrate` itself (the `vercel-build` script).

5. Optional: copy the local sandbox data (orders, the real disputes) into Neon:

   ```bash
   docker exec mandatepay-db pg_dump -U mandatepay --data-only --schema=public mandatepay > local-data.sql
   psql "<neon direct (non-pooler) url>" -f local-data.sql
   ```

   Delete `local-data.sql` afterwards. Use Neon's direct (non-pooler) URL for `psql`.

## 2. Mandate signing keys

Vercel has no lasting disk, so the two signing keys travel as environment variables. Use the keys you already
have, so mandates signed so far still verify:

```bash
npm run keys:export
```

This writes `.keys/hosting.env` (gitignored) and prints only the key ids. Copy its two lines into Vercel
(step 3), then delete the file. Never paste them into chat, issues or commits.

## 3. App on Vercel

1. Import the GitHub repo into Vercel. Framework: Next.js. Build command: leave the default; Vercel runs
   `npm run vercel-build`, which migrates the database and then builds.
2. Environment variables (Settings > Environment Variables). Production uses the Neon `prod` branch, Preview
   uses `dev`:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon pooled URL for that environment |
   | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox app credentials |
   | `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Same as `PAYPAL_CLIENT_ID` |
   | `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` |
   | `APP_BASE_URL` | The deployment URL, e.g. `https://mandatepay.vercel.app` |
   | `MANDATE_BUYER_PRIVATE_KEY`, `MANDATE_AGENT_PRIVATE_KEY` | From `.keys/hosting.env` |
   | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | As in your `.env` |
   | `PAYPAL_WEBHOOK_ID` | From step 4 |
   | `BETTER_AUTH_SECRET` | A new random value per environment (see `.env.example`); never reuse the local one |

   Store name and the approval and review limits are set in the app (Settings > Store and rules), not here.
3. Deploy.

Without the two key variables the app refuses to sign or verify mandates on Vercel, with an error naming the
missing variable. That is deliberate: a key made up per server instance would break every signature.

## 3b. First store owner

Public sign-up only creates buyers. Create the owner (and an admin if you want one) against the hosted database:

```bash
DATABASE_URL="<neon production url>" npm run auth:create-user -- --email you@example.com --name "Your Name" --role owner
```

The password goes to `.keys/new-user-<email>.txt` (or set `NEW_USER_PASSWORD` first). Sign in at
`/merchant/login`, then delete the file. The same command with an existing email only changes the role.

## 4. Webhook for the hosted URL

Register the deployment's webhook once per environment and put the printed id in `PAYPAL_WEBHOOK_ID`, then
redeploy:

```bash
npx tsx scripts/paypal-webhook.ts register https://<your-vercel-domain>
```

`npx tsx scripts/paypal-webhook.ts list` shows what is registered; remove old tunnel URLs with
`npx tsx scripts/paypal-webhook.ts delete <id>`.

## 5. Check the deployment

- `GET /api/health` returns `{"ok":true}`.
- Settings shows PayPal API, PayPal button, Webhooks and AI model as Connected.
- Place a sandbox order, open a dispute from the sandbox buyer, and watch it arrive without a tunnel.

## Limits to keep in mind

- AI routes may run up to 150 s (`maxDuration`); Vercel's Hobby plan allows this with Fluid compute.
- Each server instance opens at most 3 database connections on Vercel (`DB_POOL_MAX` to change).
- Free tiers (Gemini, Neon compute hours, Vercel) can run out during a long demo.
