/**
 * Account reads and changes for the team page and the admin console (owner: orchestrator). Password data lives in
 * the accounts table and is never read here.
 */
import type { AccountSummary } from '../contracts/schemas';
import { isRole, type Role } from './auth/roles';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  disabledAt: Date | null;
  createdAt: Date;
}

export function toAccountSummary(u: UserRow): AccountSummary {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: isRole(u.role) ? u.role : 'buyer',
    disabled: Boolean(u.disabledAt),
    created_at: u.createdAt.toISOString(),
  };
}

async function load() {
  const [orm, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../db/client')]);
  return { ...orm, db, schema };
}

const columns = async () => {
  const { schema } = await load();
  const u = schema.users;
  return { id: u.id, name: u.name, email: u.email, role: u.role, disabledAt: u.disabledAt, createdAt: u.createdAt };
};

/** Accounts, newest first. `roles` limits to those roles; `q` searches name and email. */
export async function listAccounts(opts: { roles?: readonly Role[]; q?: string; limit?: number } = {}): Promise<AccountSummary[]> {
  const { db, schema, and, desc, ilike, inArray, or } = await load();
  const u = schema.users;
  const q = opts.q?.trim();
  const rows = await db
    .select(await columns())
    .from(u)
    .where(
      and(
        opts.roles ? inArray(u.role, [...opts.roles]) : undefined,
        q ? or(ilike(u.email, `%${q}%`), ilike(u.name, `%${q}%`)) : undefined,
      ),
    )
    .orderBy(desc(u.createdAt))
    .limit(opts.limit ?? 200);
  return rows.map(toAccountSummary);
}

export async function findAccount(by: { id?: string; email?: string }): Promise<AccountSummary | undefined> {
  const { db, schema, eq } = await load();
  const u = schema.users;
  const where = by.id ? eq(u.id, by.id) : eq(u.email, (by.email ?? '').trim().toLowerCase());
  const [row] = await db.select(await columns()).from(u).where(where).limit(1);
  return row ? toAccountSummary(row) : undefined;
}

export async function countOwners(): Promise<number> {
  const { db, schema, eq, count } = await load();
  const [r] = await db.select({ n: count() }).from(schema.users).where(eq(schema.users.role, 'owner'));
  return Number(r?.n ?? 0);
}

export async function setRole(userId: string, role: Role): Promise<void> {
  const { db, schema, eq } = await load();
  await db.update(schema.users).set({ role, updatedAt: new Date() }).where(eq(schema.users.id, userId));
}

/** Disabling also ends every session the person has, so it takes effect at once. */
export async function setDisabled(userId: string, disabled: boolean): Promise<void> {
  const { db, schema, eq } = await load();
  await db
    .update(schema.users)
    .set({ disabledAt: disabled ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.users.id, userId));
  if (disabled) await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}
