/**
 * Order list for the merchant (owner: A). Every order placed through MandatePay, newest first, joined with its cart
 * (for the total and items) and with any dispute on it.
 */
import type { Cart, OrderSummary } from '../../contracts/schemas';
import { fromMinor } from './orders';

export interface OrderListRow {
  paypalOrderId: string;
  cartId: string;
  mandateId: string;
  status: string;
  captureId: string | null;
  receiptHash: string | null;
  createdAt: Date;
  capturedAt: Date | null;
  totalMinor: number;
  currency: string;
  cart: Cart;
  disputeId: string | null;
}

export function toOrderSummary(r: OrderListRow): OrderSummary {
  return {
    paypal_order_id: r.paypalOrderId,
    cart_id: r.cartId,
    mandate_id: r.mandateId,
    status: r.status,
    total: fromMinor(r.totalMinor),
    currency: r.currency,
    items: r.cart.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    ...(r.captureId ? { capture_id: r.captureId } : {}),
    ...(r.receiptHash ? { receipt_hash: r.receiptHash } : {}),
    created_at: r.createdAt.toISOString(),
    ...(r.capturedAt ? { captured_at: r.capturedAt.toISOString() } : {}),
    ...(r.disputeId ? { dispute_id: r.disputeId } : {}),
  };
}

export async function listOrders(limit = 200): Promise<OrderSummary[]> {
  const [{ desc, eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  const { orders, carts, cases } = schema;
  const rows = await db
    .select({
      paypalOrderId: orders.paypalOrderId,
      cartId: orders.cartId,
      mandateId: orders.mandateId,
      status: orders.status,
      captureId: orders.captureId,
      receiptHash: orders.receiptHash,
      createdAt: orders.createdAt,
      capturedAt: orders.capturedAt,
      totalMinor: carts.totalMinor,
      currency: carts.currency,
      cart: carts.cart,
      disputeId: cases.disputeId,
    })
    .from(orders)
    .innerJoin(carts, eq(carts.cartId, orders.cartId))
    .leftJoin(cases, eq(cases.paypalOrderId, orders.paypalOrderId))
    .orderBy(desc(orders.createdAt))
    .limit(limit);
  // An order with more than one dispute joins once per dispute; keep one row per order.
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.paypalOrderId) && seen.add(r.paypalOrderId)).map(toOrderSummary);
}
