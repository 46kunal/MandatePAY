import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { SystemHealth } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { getConfig } from '@/lib/config';
import { keyEnvName } from '@/lib/mandate/keys';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Check = z.infer<typeof SystemHealth>['checks'][number];

async function timed(name: string, run: () => Promise<string>): Promise<Check> {
  const start = Date.now();
  try {
    const detail = await run();
    return { name, ok: true, detail: `${detail} (${Date.now() - start} ms)` };
  } catch (err) {
    return { name, ok: false, detail: (err as Error).message.slice(0, 200) };
  }
}

// GET -> SystemHealth: live checks of the database, PayPal, webhooks, AI, sign-in and signing keys. Admin only.
// Reports only whether things are set and working, never their values. Does not call the AI (that costs quota).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'system:read');
  if (!authz.ok) return authz.response;
  const c = getConfig();

  const checks: Check[] = await Promise.all([
    timed('Database', async () => {
      await db.execute(sql`select 1`);
      const r = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
      const n = (r.rows?.[0] as { n?: number } | undefined)?.n;
      return `Connected, ${n ?? '?'} migrations applied`;
    }),
    timed('PayPal API', async () => {
      const { getPayPalClient } = await import('@/lib/paypal/client');
      await getPayPalClient().getAccessToken();
      return 'Sandbox credentials accepted';
    }),
    timed('Webhooks', async () => {
      if (!c.PAYPAL_WEBHOOK_ID?.trim()) throw new Error('PAYPAL_WEBHOOK_ID is not set; use Poll disputes instead.');
      const [last] = await db
        .select({ at: schema.events.receivedAt })
        .from(schema.events)
        .where(eq(schema.events.source, 'webhook'))
        .orderBy(desc(schema.events.receivedAt))
        .limit(1);
      return last ? `Configured, last event ${last.at.toISOString()}` : 'Configured, no events received yet';
    }),
    timed('AI model', async () => {
      if (!c.LLM_PROVIDER?.trim() || !c.LLM_API_KEY?.trim()) throw new Error('LLM_PROVIDER and LLM_API_KEY must be set.');
      return `${c.LLM_PROVIDER} ${c.LLM_MODEL ?? '(default model)'} configured (not called)`;
    }),
    timed('Sign-in', async () => {
      if (!process.env.BETTER_AUTH_SECRET?.trim()) throw new Error('BETTER_AUTH_SECRET is not set.');
      return 'Secret set';
    }),
    timed('Mandate signing keys', async () => {
      const fromEnv = (['buyer', 'agent'] as const).filter((r) => process.env[keyEnvName(r)]?.trim());
      if (fromEnv.length === 2) return 'Both keys from environment variables';
      if (process.env.VERCEL === '1') throw new Error('Signing keys must be environment variables on Vercel.');
      return `Key files in ${c.KEY_DIR} (local)`;
    }),
    timed('Buyer key encryption', async () => {
      if (process.env.MANDATE_KEY_ENCRYPTION_KEY?.trim()) return 'Master key from environment variable';
      if (process.env.VERCEL === '1') throw new Error('MANDATE_KEY_ENCRYPTION_KEY is not set: buyers cannot sign mandates.');
      return `Master key file in ${c.KEY_DIR} (local)`;
    }),
  ]);

  const body: z.infer<typeof SystemHealth> = { checked_at: new Date().toISOString(), checks };
  return Response.json(body);
}
