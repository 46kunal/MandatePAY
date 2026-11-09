import { PlaceOrderRequest, type PlaceOrderResponse } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { placeOrder } from '@/lib/paypal/service';
import type { z } from 'zod';
import { demoOrderDeps, requireSimulation } from '../_demo';

export const runtime = 'nodejs';

// OWNER: C. Demo twin of POST /api/orders (A). Same guard, closed mandate and ledger rows; the PayPal order is simulated.
export async function POST(req: Request) {
  const blocked = requireSimulation();
  if (blocked) return blocked;

  const body = PlaceOrderRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { mandate_id, cart, buyer_approved? }', body.error.issues);

  const result = await placeOrder(demoOrderDeps(), {
    mandateId: body.data.mandate_id,
    cart: body.data.cart,
    buyerApproved: body.data.buyer_approved,
  });
  if (!result.ok) return apiError(result.httpStatus, result.error, result.message, result.details);

  const response: z.infer<typeof PlaceOrderResponse> =
    result.status === 'created'
      ? {
          status: 'created',
          paypal_order_id: result.paypalOrderId,
          approve_url: result.approveUrl,
          cart_id: result.cartId,
          guard: result.guard,
        }
      : { status: 'needs_approval', guard: result.guard };
  return Response.json(response, { status: result.status === 'created' ? 201 : 200 });
}
