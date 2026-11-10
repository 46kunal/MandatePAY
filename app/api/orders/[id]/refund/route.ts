import { RefundOrderRequest } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { limited } from '@/lib/rateLimit';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { refundOrder } from '@/lib/paypal/refundOrder';

export const runtime = 'nodejs';

// OWNER: A. POST RefundOrderRequest -> RefundOrderResponse. Owner or admin only (orders:refund).
// Refunds all (amount omitted) or part of a captured payment through PayPal, never more than is still refundable
// (see lib/paypal/refundOrder.ts). 404 order, 409 not captured / fully refunded, 422 amount, 502 PayPal.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'orders:refund');
  if (!authz.ok) return authz.response;
  const slow = limited(authz.user.id, 'refund', 10);
  if (slow) return slow;
  const { id } = await ctx.params;
  const body = RefundOrderRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { amount?, note?, idempotency_key }.', body.error.issues);

  try {
    const r = await refundOrder(authz.user, id, { amount: body.data.amount, note: body.data.note, idempotencyKey: body.data.idempotency_key });
    if (!r.ok) return apiError(r.status, r.error, r.message);
    return Response.json(r.response);
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', `PayPal refused the refund: ${err.message}`, { debugId: err.debugId });
    throw err;
  }
}
