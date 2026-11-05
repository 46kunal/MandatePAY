import { PlaceOrderRequest, type PlaceOrderResponse } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { defaultDeps } from '@/lib/paypal/deps';
import { placeOrder } from '@/lib/paypal/service';
import type { z } from 'zod';

export const runtime = 'nodejs';

// OWNER: A. POST { mandate_id, cart, buyer_approved } -> PlaceOrderResponse.
// Runs B's guard on the signed mandate, closes the mandate over this cart, then creates the PayPal order with
// custom_id = mandate_id and invoice_id = cart_id. Blocked carts return 422 { error: 'guard_blocked', details: GuardResult }.
export async function POST(req: Request) {
  const body = PlaceOrderRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { mandate_id, cart, buyer_approved? }', body.error.issues);

  try {
    const result = await placeOrder(defaultDeps(), {
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
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', err.message, { debugId: err.debugId });
    throw err;
  }
}
