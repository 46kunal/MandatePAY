/**
 * Shared Drizzle client (owner: C). Reuses one pool across hot reloads in dev.
 * On serverless hosts (Vercel) every instance opens its own pool, so keep it small and use the provider's pooled
 * connection string (Neon: the "-pooler" host). DB_POOL_MAX overrides the size.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { __mandatepayPool?: Pool };

const pool =
  globalForDb.__mandatepayPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 10),
    idleTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__mandatepayPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
