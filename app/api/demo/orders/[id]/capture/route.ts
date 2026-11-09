import type { CaptureOrderResponse } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { captureStoredOrder } from '@/lib/paypal/service';
import type { z } from 'zod';
import { demoOrderDeps, requireSimulation } from '../../../_demo';

export const runtime = 'nodejs';

// OWNER: C. Demo twin of POST /api/orders/:id/capture (A). Real closed-mandate check and receipt hash, simulated capture.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = requireSimulation();
  if (blocked) return blocked;

  const { id } = await ctx.params;
  const result = await captureStoredOrder(demoOrderDeps(), id);
  if (!result.ok) return apiError(result.httpStatus, result.error, result.message);
  const response: z.infer<typeof CaptureOrderResponse> = {
    paypal_order_id: result.paypalOrderId,
    capture_id: result.captureId,
    status: result.status,
  };
  return Response.json(response);
}
