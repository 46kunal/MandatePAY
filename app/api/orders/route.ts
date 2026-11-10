import { PlaceOrderRequest, type ListOrdersResponse, type PlaceOrderResponse } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { defaultDeps } from '@/lib/paypal/deps';
import { listOrders } from '@/lib/paypal/orderList';
import { placeOrder } from '@/lib/paypal/service';
import type { z } from 'zod';
import { requirePermission, sessionUser } from '@/lib/auth/guard';
import { mandateOwnerId, notOwned } from '@/lib/auth/ownership';
import { can } from '@/lib/auth/roles';

export const runtime = 'nodejs';
// Calls the AI model: up to 60 s per attempt plus one fallback attempt.
export const maxDuration = 150;
export const dynamic = 'force-dynamic';

// OWNER: A. GET -> ListOrdersResponse, newest first, with totals and any dispute id. Merchant staff see every order;
// a buyer sees only their own.
export async function GET(req: Request) {
  const user = await sessionUser(req.headers);
  if (!user) return apiError(401, 'unauthenticated', 'Sign in to continue.');
  const all = can(user.role, 'orders:read:all');
  const body: z.infer<typeof ListOrdersResponse> = { orders: await listOrders(all ? {} : { userId: user.id }) };
  return Response.json(body);
}

// OWNER: A. POST { mandate_id, cart, buyer_approved } -> PlaceOrderResponse.
// Runs B's guard on the signed mandate, closes the mandate over this cart, then creates the PayPal order with
// custom_id = mandate_id and invoice_id = cart_id. Blocked carts return 422 { error: 'guard_blocked', details: GuardResult }.
export async function POST(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const body = PlaceOrderRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { mandate_id, cart, buyer_approved? }', body.error.issues);

  const denied = notOwned(await mandateOwnerId(body.data.mandate_id), authz.user.id, 'mandate', body.data.mandate_id);
  if (denied) return denied;

  try {
    const result = await placeOrder(defaultDeps(), {
      mandateId: body.data.mandate_id,
      cart: body.data.cart,
      buyerApproved: body.data.buyer_approved,
      funding: body.data.funding,
    });
    if (!result.ok) return apiError(result.httpStatus, result.error, result.message, result.details);

    const response: z.infer<typeof PlaceOrderResponse> =
      result.status === 'created'
        ? {
            status: 'created',
            paypal_order_id: result.paypalOrderId,
            ...(result.approveUrl ? { approve_url: result.approveUrl } : {}),
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
