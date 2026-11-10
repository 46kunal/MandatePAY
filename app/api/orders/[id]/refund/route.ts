import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { RefundOrderRequest, type RefundOrderResponse } from '@/contracts/schemas';
import { audit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import { apiError } from '@/lib/http';
import { PayPalConfigError, PayPalError } from '@/lib/paypal';
import { defaultPollDeps } from '@/lib/paypal/deps';
import { fetchDisputeById } from '@/lib/paypal/disputeService';
import { fromMinor, toMinor } from '@/lib/paypal/orders';
import { planRefund, refreshOrderRefunds, refundableMinor, refundCapture, summariseRefunds } from '@/lib/paypal/refunds';
import type { z } from 'zod';

export const runtime = 'nodejs';

// OWNER: A. POST RefundOrderRequest -> RefundOrderResponse. Owner or admin only (orders:refund).
// Refunds all (amount omitted) or part of a captured payment through PayPal, never more than is still refundable
// (refunds made in the PayPal dashboard count too, re-read from PayPal first). idempotency_key becomes the
// PayPal-Request-Id, so a repeated click with the same key cannot refund twice.
// 404 order, 409 not captured / fully refunded, 422 amount, 502 PayPal.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'orders:refund');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const body = RefundOrderRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { amount?, note?, idempotency_key }.', body.error.issues);

  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, id)).limit(1);
  if (!order) return apiError(404, 'order_not_found', `No order with id ${id}.`);
  if (!order.captureId) return apiError(409, 'not_captured', 'This order was never paid, so there is nothing to refund.');
  const [cart] = await db.select().from(schema.carts).where(eq(schema.carts.cartId, order.cartId)).limit(1);
  if (!cart) return apiError(422, 'ledger_incomplete', 'The cart for this order is missing.');

  try {
    // Always fresh: a refund decision must see refunds made a moment ago in the PayPal dashboard.
    const before = await refreshOrderRefunds(id);
    const plan = planRefund(cart.totalMinor, before, body.data.amount ? toMinor(body.data.amount) : undefined);
    if (!plan.ok) return apiError(plan.status, plan.error, plan.message);

    const refund = await refundCapture(order.captureId, {
      amountMinor: plan.amountMinor,
      currency: cart.currency,
      note: body.data.note,
      requestId: `refund-${order.captureId}-${body.data.idempotency_key}`,
    });
    const after = await refreshOrderRefunds(id);
    await audit(authz.user, {
      action: 'order.refund',
      targetType: 'order',
      targetId: id,
      details: { amount: fromMinor(plan.amountMinor), currency: cart.currency, paypal_refund_id: refund.id, status: refund.status },
    });

    // A linked dispute is re-read, so its page shows what PayPal makes of the refund.
    const [linked] = await db.select({ disputeId: schema.cases.disputeId }).from(schema.cases).where(eq(schema.cases.paypalOrderId, id)).limit(1);
    if (linked) await fetchDisputeById(defaultPollDeps(), linked.disputeId).catch(() => undefined);

    const response: z.infer<typeof RefundOrderResponse> = {
      refund_id: refund.id,
      status: refund.status,
      amount: fromMinor(plan.amountMinor),
      currency: cart.currency,
      refunded_total: fromMinor(summariseRefunds(after).total_minor),
      remaining: fromMinor(refundableMinor(cart.totalMinor, after)),
    };
    return Response.json(response);
  } catch (err) {
    if (err instanceof PayPalConfigError) return apiError(500, 'paypal_not_configured', err.message);
    if (err instanceof PayPalError) return apiError(502, 'paypal_error', `PayPal refused the refund: ${err.message}`, { debugId: err.debugId });
    throw err;
  }
}
