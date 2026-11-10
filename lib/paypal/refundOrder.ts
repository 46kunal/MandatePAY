/**
 * Refund all or part of an order's payment through PayPal (owner: A). Shared by POST /api/orders/:id/refund and by
 * answering a buyer's problem report. Never refunds more than is still refundable: refunds made in the PayPal
 * dashboard count too (re-read from PayPal first). idempotencyKey becomes the PayPal-Request-Id, so a repeated click
 * with the same key cannot refund twice. PayPal errors are thrown (PayPalError, PayPalConfigError) for the caller.
 */
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { RefundOrderResponse } from '../../contracts/schemas';
import { db, schema } from '../../db/client';
import { audit, type AuditActor } from '../audit';
import { defaultPollDeps } from './deps';
import { fetchDisputeById } from './disputeService';
import { fromMinor, toMinor } from './orders';
import { planRefund, refreshOrderRefunds, refundableMinor, refundCapture, summariseRefunds } from './refunds';

export type RefundOrderResult =
  | { ok: true; response: z.infer<typeof RefundOrderResponse>; amountMinor: number }
  | { ok: false; status: number; error: string; message: string };

export async function refundOrder(
  actor: AuditActor,
  orderId: string,
  opts: { amount?: string; note?: string; idempotencyKey: string; reason?: string },
): Promise<RefundOrderResult> {
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, orderId)).limit(1);
  if (!order) return { ok: false, status: 404, error: 'order_not_found', message: `No order with id ${orderId}.` };
  if (!order.captureId) return { ok: false, status: 409, error: 'not_captured', message: 'This order was never paid, so there is nothing to refund.' };
  const [cart] = await db.select().from(schema.carts).where(eq(schema.carts.cartId, order.cartId)).limit(1);
  if (!cart) return { ok: false, status: 422, error: 'ledger_incomplete', message: 'The cart for this order is missing.' };

  // Always fresh: a refund decision must see refunds made a moment ago in the PayPal dashboard.
  const before = await refreshOrderRefunds(orderId);
  const plan = planRefund(cart.totalMinor, before, opts.amount ? toMinor(opts.amount) : undefined);
  if (!plan.ok) return { ok: false, status: plan.status, error: plan.error, message: plan.message };

  const refund = await refundCapture(order.captureId, {
    amountMinor: plan.amountMinor,
    currency: cart.currency,
    note: opts.note,
    requestId: `refund-${order.captureId}-${opts.idempotencyKey}`,
  });
  const after = await refreshOrderRefunds(orderId);
  await audit(actor, {
    action: 'order.refund',
    targetType: 'order',
    targetId: orderId,
    details: { amount: fromMinor(plan.amountMinor), currency: cart.currency, paypal_refund_id: refund.id, status: refund.status, ...(opts.reason ? { reason: opts.reason } : {}) },
  });

  // A linked dispute is re-read, so its page shows what PayPal makes of the refund.
  const [linked] = await db.select({ disputeId: schema.cases.disputeId }).from(schema.cases).where(eq(schema.cases.paypalOrderId, orderId)).limit(1);
  if (linked) await fetchDisputeById(defaultPollDeps(), linked.disputeId).catch(() => undefined);

  return {
    ok: true,
    amountMinor: plan.amountMinor,
    response: {
      refund_id: refund.id,
      status: refund.status,
      amount: fromMinor(plan.amountMinor),
      currency: cart.currency,
      refunded_total: fromMinor(summariseRefunds(after).total_minor),
      remaining: fromMinor(refundableMinor(cart.totalMinor, after)),
    },
  };
}
