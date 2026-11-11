# Demo data: wipe, seed, rehearse

Gets the live site ready to record: one store ("MandatePay Market") with **five seller brands and 25 products with
pictures**, a store team, and a few shoppers. Orders, mandates and disputes start empty so the demo tells one clean story.

## What you get

| | |
|---|---|
| Store | MandatePay Market. Every payment goes to the one PayPal account; each product shows **Sold by** its brand. |
| Brands | Stride Lab (trainers), Loomhouse (clothing), Fieldnote (stationery, bags), Brightwire (electronics), Tidewater (home). |
| Team | You (owner, kept), Maya Chen (admin), Jordan Ellis, Priya Nair, Tom Becker (staff). |
| Shoppers | Sam Rivera (email), plus **two you create by choosing Continue with PayPal** with two sandbox personal accounts. |
| Pictures | Free-licence photos from [Pexels](https://www.pexels.com/license/), linked and not stored in the repo. |

The demo request "white running trainers, size 10, under 110 USD" matches the Aero Runner (89.00) and is blocked on the
Aero Pro Racer (149.00), which is what the video shows.

## Steps

1. **Deploy first.** The new `seller` column (migration 0014) is applied by the Vercel build. Merge to `main` and wait for it.
2. **Wipe** (Neon console, SQL Editor): open `scripts/wipe-keep-owner.sql`, replace `OWNER_EMAIL_HERE` with your owner
   login, run it. It keeps only your owner account and the store settings, and shows the counts. It cannot be undone.
3. **Seed**, from your own terminal with the live database URL in the variable (do not paste the URL anywhere else):

   ```bash
   SEED_DATABASE_URL="<your Neon connection string>" npm run seed:demo -- --yes
   ```

   It is safe to run twice. Passwords for the new accounts go to `.keys/demo-accounts.txt` (gitignored, never printed).
   Delete that file when you no longer need it. The seed uses the app's own sign-up code with your local `.env` for
   everything except the database.
4. **Two PayPal shoppers.** Needs `NEXT_PUBLIC_PAYPAL_LOGIN_ENABLED=1` on the site. Sign out, choose *Continue with
   PayPal*, sign in with each sandbox personal account once. They become shoppers automatically.
5. **Buyer set-up** (as a PayPal shopper): New purchase, sign the mandate for white trainers size 10 under 110 USD;
   Account, Agent access, create a key and connect Claude Code with the command shown.
6. **Dispute set-up:** place and pay one order, raise "item not as described" in the PayPal sandbox Resolution Center,
   wait for it to appear in the store and for the AI analysis to finish. Do not press Escalate.
7. **Rehearse the agent once** against the live site, including `place_order` and the PayPal approval, so the first
   call in the recording is not slow.

## Things to know

- PayPal still holds earlier sandbox orders and disputes. If an old dispute reappears after the wipe, use **Dismiss**.
- Orders paid before the wipe are gone from this site, so their disputes cannot be matched to a signed record.
- Seller brands are labels on products, not separate PayPal merchants: one PayPal account receives every payment.

## Photo credits

All photos are from Pexels under the Pexels licence (free to use, no attribution required; credited here anyway).
Photo ids used: 1461048, 6050912, 18202570, 1456705, 5603269, 5464589, 14641440, 5746087, 7432216, 7598077, 2081199,
4452399, 5594336, 8148587, 3921713, 3921630, 11599423, 4792712, 4072683, 3737800, 4466240, 9707245, 10610004, 2417857
(`https://www.pexels.com/photo/<id>/`). Some are close matches rather than exact (the Trail Grip photo is a running
shoe on grass).
