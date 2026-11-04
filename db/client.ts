/** Shared Drizzle client (owner: C). Reuses one pool across hot reloads in dev. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalForDb = globalThis as unknown as { __mandatepayPool?: Pool };

const pool =
  globalForDb.__mandatepayPool ?? new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__mandatepayPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
