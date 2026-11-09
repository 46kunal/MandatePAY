import { getConfig } from '@/lib/config';
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
  });
}
