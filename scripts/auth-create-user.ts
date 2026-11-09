// Creates a store-team account (staff, owner or admin), or changes an existing account's role. Public sign-up only
// ever makes buyers, so this is how the first owner and admin are made.
//
//   npm run auth:create-user -- --email you@example.com --name "Your Name" --role owner
//   npm run auth:create-user -- --email someone@example.com --role staff        (existing account: role change only)
//
// Password: taken from NEW_USER_PASSWORD if set; otherwise a strong one is generated and written to
// .keys/new-user-<email>.txt (gitignored). The password is never printed. Sign in, then delete that file.
// Targets DATABASE_URL: your local database by default. For Neon production run with that database's URL, e.g.
//   DATABASE_URL="<neon production url>" npm run auth:create-user -- --email ... --role owner
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { isRole, ROLES } = await import('../lib/auth/roles');
  const email = arg('email')?.trim().toLowerCase();
  const role = arg('role')?.trim();
  const name = arg('name')?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Pass --email with a valid address.');
  if (!isRole(role)) throw new Error(`Pass --role, one of: ${ROLES.join(', ')}.`);

  const [{ eq }, { db, schema }, { auth }] = await Promise.all([
    import('drizzle-orm'),
    import('../db/client'),
    import('../lib/auth/server'),
  ]);

  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) {
    await db.update(schema.users).set({ role, updatedAt: new Date() }).where(eq(schema.users.id, existing.id));
    console.log(`Updated ${email}: role ${existing.role} -> ${role}. Password unchanged.`);
    return;
  }

  const given = process.env.NEW_USER_PASSWORD;
  const password = given && given.length >= 10 ? given : randomBytes(15).toString('base64url');
  await auth.api.signUpEmail({ body: { email, password, name: name || email.split('@')[0] } });
  await db.update(schema.users).set({ role, updatedAt: new Date() }).where(eq(schema.users.email, email));

  if (given) {
    console.log(`Created ${email} as ${role} with the password from NEW_USER_PASSWORD.`);
  } else {
    const dir = path.resolve('.keys');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `new-user-${email.replace(/[^a-z0-9._-]/g, '_')}.txt`);
    await fs.writeFile(file, `email=${email}\npassword=${password}\n`, { mode: 0o600 });
    console.log(`Created ${email} as ${role}. Password written to ${file}. Sign in, change it later, then delete the file.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
