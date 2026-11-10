import { getConfig } from '@/lib/config';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getSettings } from '@/lib/settings';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> what the server is connected to, for the settings page and the buyer checkout. No secrets.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'status:read');
  if (!authz.ok) return authz.response;
  const c = getConfig();
  return Response.json({
    paypal_configured: Boolean(c.PAYPAL_CLIENT_ID?.trim() && c.PAYPAL_CLIENT_SECRET?.trim()),
    paypal_button_configured: Boolean(process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim()),
    webhooks_configured: Boolean(c.PAYPAL_WEBHOOK_ID?.trim()),
    llm_provider: c.LLM_PROVIDER?.trim().toLowerCase() || null,
    llm_model: c.LLM_MODEL?.trim() || null,
    llm_configured: Boolean(c.LLM_PROVIDER?.trim() && c.LLM_API_KEY?.trim()),
    merchant_name: (await getSettings()).store_name,
    last_webhook_at: await lastWebhookAt(),
    last_webhook_rejected: await lastWebhookRejected(),
  });
}

async function lastWebhookAt(): Promise<string | null> {
  const [last] = await db
    .select({ at: schema.events.receivedAt })
    .from(schema.events)
    .where(eq(schema.events.source, 'webhook'))
    .orderBy(desc(schema.events.receivedAt))
    .limit(1);
  return last ? last.at.toISOString() : null;
}

/** The latest time PayPal called the webhook and was refused (wrong webhook id, bad signature), and why. */
async function lastWebhookRejected(): Promise<{ at: string; error: string } | null> {
  const [last] = await db
    .select({ at: schema.auditLog.at, details: schema.auditLog.details })
    .from(schema.auditLog)
    .where(eq(schema.auditLog.action, 'webhook.rejected'))
    .orderBy(desc(schema.auditLog.at))
    .limit(1);
  if (!last) return null;
  return { at: last.at.toISOString(), error: typeof last.details?.error === 'string' ? last.details.error : 'rejected' };
}
