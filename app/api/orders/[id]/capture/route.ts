import type { CaptureOrderResponse } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { defaultDeps } from '@/lib/paypal/deps';
import { captureStoredOrder } from '@/lib/paypal/service';
import type { z } from 'zod';
import { requirePermission } from '@/lib/auth/guard';
import { notOwned, orderOwnerId } from '@/lib/auth/ownership';

export const runtime = 'nodejs';

// OWNER: A. POST -> CaptureOrderResponse. Verifies the closed mandate, captures with a stable PayPal-Request-Id,
// then stores capture_id and receipt_hash. 404 unknown order, 409 already captured, 502 PayPal.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const denied = notOwned(await orderOwnerId(id), authz.user.id, 'order', id);
  if (denied) return denied;
  try {
    const result = await captureStoredOrder(defaultDeps(), id);
    if (!result.ok) return apiError(result.httpStatus, result.error, result.message);
    const response: z.infer<typeof CaptureOrderResponse> = {
      paypal_order_id: result.paypalOrderId,
      capture_id: result.captureId,
      status: result.status,
    };
    return Response.json(response);
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', err.message, { debugId: err.debugId });
    throw err;
  }
}
