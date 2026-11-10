import { AgentShopRequest, type AgentShopResponse } from '@/contracts/schemas';
import { LlmError } from '@/lib/ai';
import { shop } from '@/lib/agent/shop';
import { listBuyableProducts } from '@/lib/catalog/products';
import { getSettings } from '@/lib/settings';
import { apiError } from '@/lib/http';
import { checkCart, verifyOpenMandate } from '@/lib/mandate';
import type { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { limited } from '@/lib/rateLimit';
import { mandateOwnerId, notOwned } from '@/lib/auth/ownership';

export const runtime = 'nodejs';
// Calls the AI model: up to 60 s per attempt plus one fallback attempt.
export const maxDuration = 150;

// POST { mandate_id } -> AgentShopResponse. The agent reads the merchant catalog and proposes a cart, which the guard checks.
// 404 mandate, 410 expired, 422 empty catalog / nothing fits, 500 LLM not configured, 502 LLM failed.
export async function POST(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const slow = limited(authz.user.id, 'ai', 10);
  if (slow) return slow;
  const body = AgentShopRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { mandate_id }.', body.error.issues);

  const denied = notOwned(await mandateOwnerId(body.data.mandate_id), authz.user.id, 'mandate', body.data.mandate_id);
  if (denied) return denied;

  try {
    const result = await shop(
      {
        async loadMandate(mandateId) {
          const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('@/db/client')]);
          const [row] = await db.select().from(schema.mandates).where(eq(schema.mandates.mandateId, mandateId)).limit(1);
          if (!row) return { ok: false, status: 404, error: 'mandate_not_found', message: `No mandate with id ${mandateId}.` };
          if (row.revokedAt) return { ok: false, status: 410, error: 'mandate_revoked', message: 'The buyer revoked this mandate. Sign a new one to keep shopping.' };
          // Constraints come from the signed token, never from the unsigned column.
          const v = await verifyOpenMandate(row.jws);
          if (!v.ok) {
            return v.reason === 'expired'
              ? { ok: false, status: 410, error: 'mandate_expired', message: v.message }
              : { ok: false, status: 422, error: 'mandate_invalid', message: v.message };
          }
          return { ok: true, jws: row.jws, constraints: v.payload.constraints };
        },
        listCatalog: listBuyableProducts,
        async checkCart(jws, cart) {
          const r = await checkCart(jws, cart);
          if (!r.ok) throw new Error(r.message);
          return r.guard;
        },
        merchantName: (await getSettings()).store_name,
      },
      body.data.mandate_id,
    );
    if (!result.ok) return apiError(result.status, result.error, result.message, result.details);
    const response: z.infer<typeof AgentShopResponse> = {
      cart: result.cart,
      picks: result.picks,
      summary: result.summary,
      guard: result.guard,
      considered: result.considered,
    };
    return Response.json(response);
  } catch (err) {
    if (err instanceof LlmError) {
      return apiError(err.code === 'config' ? 500 : 502, err.code === 'config' ? 'llm_not_configured' : 'llm_failed', err.message);
    }
    throw err;
  }
}
