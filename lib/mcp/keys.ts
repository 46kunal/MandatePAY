/**
 * Agent keys (owner: orchestrator). A buyer makes a key so an outside AI agent can act for them over MCP, inside the
 * mandates the buyer already signed. Only the SHA-256 of a key is stored (a key is 24 random bytes, so a fast hash is
 * enough); the key itself is shown once, when it is made.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export const KEY_PREFIX = 'mpk_';

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function newKey(): { key: string; prefix: string; hash: string } {
  const key = KEY_PREFIX + randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, 10), hash: hashKey(key) };
}

export function looksLikeKey(token: string): boolean {
  return token.startsWith(KEY_PREFIX) && token.length >= 20 && token.length <= 80;
}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

async function load() {
  const [{ and, desc, eq, isNull }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  return { and, desc, eq, isNull, db, schema };
}

const view = (r: { id: string; name: string; prefix: string; createdAt: Date; lastUsedAt: Date | null; revokedAt: Date | null }): ApiKeyView => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  created_at: r.createdAt.toISOString(),
  last_used_at: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  revoked_at: r.revokedAt ? r.revokedAt.toISOString() : null,
});

export async function createApiKey(userId: string, name: string): Promise<{ key: string; view: ApiKeyView }> {
  const { db, schema } = await load();
  const k = newKey();
  const [row] = await db
    .insert(schema.apiKeys)
    .values({ id: randomUUID(), userId, name: name.trim().slice(0, 60) || 'Agent', prefix: k.prefix, keyHash: k.hash })
    .returning();
  return { key: k.key, view: view(row) };
}

export async function listApiKeys(userId: string): Promise<ApiKeyView[]> {
  const { desc, eq, db, schema } = await load();
  const rows = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, userId)).orderBy(desc(schema.apiKeys.createdAt)).limit(50);
  return rows.map(view);
}

/** true when revoked now; false when it was not found, not theirs, or already revoked. */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const { and, eq, isNull, db, schema } = await load();
  const done = await db
    .update(schema.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.userId, userId), isNull(schema.apiKeys.revokedAt)))
    .returning({ id: schema.apiKeys.id });
  return done.length > 0;
}

export interface KeyUser {
  id: string;
  email: string;
  name: string;
  role: string;
  keyId: string;
}

/** The buyer a key belongs to, or null when the key is unknown, revoked, or its owner is disabled. */
export async function findUserByKey(token: string): Promise<KeyUser | null> {
  if (!looksLikeKey(token)) return null;
  const { and, eq, isNull, db, schema } = await load();
  const [row] = await db
    .select({ keyId: schema.apiKeys.id, id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role, disabledAt: schema.users.disabledAt })
    .from(schema.apiKeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.apiKeys.userId))
    .where(and(eq(schema.apiKeys.keyHash, hashKey(token)), isNull(schema.apiKeys.revokedAt)))
    .limit(1);
  if (!row || row.disabledAt) return null;
  // Best effort: when it was last used, so the buyer can spot a key that is still in use.
  void db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, row.keyId)).catch(() => undefined);
  return { id: row.id, email: row.email, name: row.name, role: row.role ?? 'buyer', keyId: row.keyId };
}
