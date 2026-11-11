// Builds the demo marketplace: store name, 25 products across five seller brands with pictures, a store team and a
// shopper. Safe to run twice: products are matched by SKU and accounts that already exist are left alone.
//
//   npm run seed:demo                          (your local database)
//   SEED_DATABASE_URL="<the live url>" npm run seed:demo -- --yes     (see docs/DEMO_DATA.md)
//
// Passwords for NEW accounts are generated and written to .keys/demo-accounts.txt (gitignored), never printed.
// Sign-in with PayPal accounts are not made here: those shoppers create themselves the first time they sign in.
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

async function main() {
  const target = process.env.SEED_DATABASE_URL?.trim();
  if (target) process.env.DATABASE_URL = target;
  const url = process.env.DATABASE_URL ?? '';
  if (!url) throw new Error('No database: set DATABASE_URL (or SEED_DATABASE_URL).');
  let host = 'unknown';
  try {
    host = new URL(url).host;
  } catch {
    /* an unusual connection string: show nothing rather than guess */
  }
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host);
  if (!local && !process.argv.includes('--yes')) {
    throw new Error(`This would write to ${host}, which is not a local database. Add --yes if that is what you want.`);
  }
  console.log(`Seeding ${host}`);

  const [{ eq }, { db, schema }, { createProduct, updateProduct }, { auth }, demo] = await Promise.all([
    import('drizzle-orm'),
    import('../db/client'),
    import('../lib/catalog/products'),
    import('../lib/auth/server'),
    import('./demo-data'),
  ]);

  // The store itself.
  await db
    .insert(schema.settings)
    .values({ id: 'store', storeName: demo.STORE_NAME, supportEmail: demo.SUPPORT_EMAIL })
    .onConflictDoUpdate({ target: schema.settings.id, set: { storeName: demo.STORE_NAME, supportEmail: demo.SUPPORT_EMAIL, updatedAt: new Date() } });

  // Products, matched by SKU.
  let made = 0;
  let updated = 0;
  for (const p of demo.PRODUCTS) {
    const [existing] = await db.select({ id: schema.products.productId }).from(schema.products).where(eq(schema.products.sku, p.sku)).limit(1);
    if (existing) {
      await updateProduct(existing.id, { ...p, active: true });
      updated++;
    } else {
      const r = await createProduct(p);
      if (!r.ok) throw new Error(r.message);
      made++;
    }
  }
  console.log(`Products: ${made} created, ${updated} updated (${demo.PRODUCTS.length} in the catalogue).`);

  // The team and a shopper.
  const lines: string[] = [];
  let newAccounts = 0;
  for (const a of demo.ACCOUNTS) {
    const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, a.email)).limit(1);
    if (existing) {
      await db.update(schema.users).set({ role: a.role, name: a.name, updatedAt: new Date() }).where(eq(schema.users.id, existing.id));
      continue;
    }
    const password = randomBytes(15).toString('base64url');
    await auth.api.signUpEmail({ body: { email: a.email, password, name: a.name } });
    await db.update(schema.users).set({ role: a.role, updatedAt: new Date() }).where(eq(schema.users.email, a.email));
    lines.push(`${a.role.padEnd(6)} ${a.name.padEnd(14)} ${a.email}  ${password}`);
    newAccounts++;
  }
  if (lines.length) {
    const dir = path.resolve('.keys');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'demo-accounts.txt');
    await fs.writeFile(file, `role   name           email  password\n${lines.join('\n')}\n`, { mode: 0o600 });
    console.log(`Accounts: ${newAccounts} created. Their passwords are in ${file} (not printed). Delete it once you have signed in.`);
  } else {
    console.log('Accounts: all already exist; nothing changed except roles and names.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
