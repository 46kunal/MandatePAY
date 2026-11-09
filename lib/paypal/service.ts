/**
 * Order placement and capture (owner: A). Pure orchestration over injected dependencies, so it is unit-tested
 * without Postgres or PayPal. Routes build the real dependencies with defaultDeps().
 *
 * Flow:  verify mandate + guard (B)  ->  closed mandate (B)  ->  PayPal order  ->  ledger rows
 *        capture  ->  capture_id + receipt_hash on the order row.
 */
import { randomBytes } from 'node:crypto';
import type { Cart, GuardResult } from '../../contracts/schemas';
import type { CheckCartOutcome } from '../mandate/check';
import type { ClosedMandate, ReceiptInput } from '../mandate/closed';
import type { CapturedOrder, CreatedOrder, CreateOrderInput } from './orders';
import { cartTotalMinor } from './orders';

// ---------- ledger rows (shape of the Drizzle tables, without the Drizzle types) ----------

export interface MandateRow {
  mandateId: string;
  jws: string;
}

export interface CartRow {
  cartId: string;
  mandateId: string;
  cart: Cart;
  cartHash: string;
  totalMinor: number;
  currency: string;
  guard: GuardResult;
  closedMandateJws: string | null;
  approvedBy: 'buyer' | 'agent' | null;
}

export interface OrderRow {
  paypalOrderId: string;
  cartId: string;
  mandateId: string;
  status: string;
  approveUrl: string | null;
  captureId: string | null;
  receiptHash: string | null;
}

export interface LedgerStore {
  getMandate(mandateId: string): Promise<MandateRow | undefined>;
  getCart(cartId: string): Promise<CartRow | undefined>;
  getOrder(paypalOrderId: string): Promise<OrderRow | undefined>;
  insertCart(row: CartRow): Promise<void>;
  insertOrder(row: OrderRow): Promise<void>;
  /**
   * An uncaptured order for the same mandate, cart contents and approver, created after `since`. Lets a repeated
   * checkout click reuse the order instead of opening another one. Optional: without it every click creates an order.
   */
  findOpenOrder?(q: { mandateId: string; cartHash: string; approvedBy: 'buyer' | 'agent'; since: Date }): Promise<
    { paypalOrderId: string; approveUrl: string | null; cartId: string } | undefined
  >;
  /** Sets capture fields only if the order has no capture yet. Returns false when it already had one. */
  markCaptured(
    paypalOrderId: string,
    fields: { status: string; captureId: string; receiptHash: string },
  ): Promise<boolean>;
}

export interface OrderDeps {
  store: LedgerStore;
  checkCart: (mandateJws: string, cart: Cart) => Promise<CheckCartOutcome>;
  hashCart: (cart: Cart) => string;
  createClosedMandate: (input: {
    mandateId: string;
    openMandateJws: string;
    cart: Cart;
    approvedBy: 'buyer' | 'agent';
  }) => Promise<ClosedMandate>;
  verifyClosedMandate: (
    jws: string,
    approvedBy: 'buyer' | 'agent',
    expected: { openMandateJws?: string; cart?: Cart },
  ) => Promise<{ ok: boolean; message?: string }>;
  computeReceiptHash: (input: ReceiptInput) => string;
  createOrder: (input: CreateOrderInput) => Promise<CreatedOrder>;
  captureOrder: (paypalOrderId: string) => Promise<CapturedOrder>;
  newCartId?: () => string;
  now?: () => Date;
}

/** An unpaid order is reused for this long. PayPal lets the buyer approve it for about three hours. */
export const OPEN_ORDER_REUSE_MS = 3 * 60 * 60 * 1000;

// ---------- place order ----------

export type PlaceOrderResult =
  | { ok: true; status: 'created'; paypalOrderId: string; approveUrl: string; cartId: string; guard: GuardResult }
  | { ok: true; status: 'needs_approval'; guard: GuardResult }
  | { ok: false; httpStatus: 404 | 410 | 422; error: string; message: string; details?: unknown };

export async function placeOrder(
  deps: OrderDeps,
  input: { mandateId: string; cart: Cart; buyerApproved: boolean },
): Promise<PlaceOrderResult> {
  const { store } = deps;
  const mandate = await store.getMandate(input.mandateId);
  if (!mandate) {
    return { ok: false, httpStatus: 404, error: 'mandate_not_found', message: `No mandate with id ${input.mandateId}.` };
  }

  // Constraints come from the signed token, never from the database column.
  const checked = await deps.checkCart(mandate.jws, input.cart);
  if (!checked.ok) {
    return { ok: false, httpStatus: checked.status, error: checked.error, message: checked.message };
  }
  const { guard } = checked;

  const cartId = deps.newCartId?.() ?? `cart_${randomBytes(8).toString('hex')}`;
  const base = {
    cartId,
    mandateId: mandate.mandateId,
    cart: input.cart,
    cartHash: deps.hashCart(input.cart),
    totalMinor: cartTotalMinor(input.cart),
    currency: input.cart.currency,
    guard,
  };

  // Blocked carts are recorded (useful as evidence) but never reach PayPal.
  if (guard.verdict === 'block') {
    await store.insertCart({ ...base, closedMandateJws: null, approvedBy: null });
    return {
      ok: false,
      httpStatus: 422,
      error: 'guard_blocked',
      message: 'The cart violates the mandate.',
      details: guard,
    };
  }

  // Escalated carts wait for an explicit buyer click.
  if (guard.verdict === 'escalate' && !input.buyerApproved) {
    await store.insertCart({ ...base, closedMandateJws: null, approvedBy: null });
    return { ok: true, status: 'needs_approval', guard };
  }

  const approvedBy = input.buyerApproved ? 'buyer' : 'agent';

  // A second click for the same cart reuses the open order rather than creating another one at PayPal.
  const open = await store.findOpenOrder?.({
    mandateId: mandate.mandateId,
    cartHash: base.cartHash,
    approvedBy,
    since: new Date((deps.now?.() ?? new Date()).getTime() - OPEN_ORDER_REUSE_MS),
  });
  if (open?.approveUrl) {
    return { ok: true, status: 'created', paypalOrderId: open.paypalOrderId, approveUrl: open.approveUrl, cartId: open.cartId, guard };
  }

  const closed = await deps.createClosedMandate({
    mandateId: mandate.mandateId,
    openMandateJws: mandate.jws,
    cart: input.cart,
    approvedBy,
  });
  // The cart row is written before PayPal is called: orders.cart_id references it.
  await store.insertCart({ ...base, closedMandateJws: closed.jws, approvedBy });

  const order = await deps.createOrder({ mandateId: mandate.mandateId, cartId, cart: input.cart });
  await store.insertOrder({
    paypalOrderId: order.paypalOrderId,
    cartId,
    mandateId: mandate.mandateId,
    status: order.status,
    approveUrl: order.approveUrl,
    captureId: null,
    receiptHash: null,
  });

  return { ok: true, status: 'created', paypalOrderId: order.paypalOrderId, approveUrl: order.approveUrl, cartId, guard };
}

// ---------- capture ----------

export type CaptureResult =
  | { ok: true; paypalOrderId: string; captureId: string; status: string }
  | { ok: false; httpStatus: 404 | 409 | 422; error: string; message: string };

export async function captureStoredOrder(deps: OrderDeps, paypalOrderId: string): Promise<CaptureResult> {
  const { store } = deps;
  const order = await store.getOrder(paypalOrderId);
  if (!order) return { ok: false, httpStatus: 404, error: 'order_not_found', message: `No order ${paypalOrderId}.` };
  if (order.captureId) {
    return { ok: false, httpStatus: 409, error: 'already_captured', message: 'This order was already captured.' };
  }

  const [cartRow, mandate] = await Promise.all([store.getCart(order.cartId), store.getMandate(order.mandateId)]);
  if (!cartRow || !mandate) {
    return { ok: false, httpStatus: 422, error: 'ledger_incomplete', message: 'Order has no cart or mandate on record.' };
  }

  // Never take money for a cart whose closed mandate does not verify against this mandate and cart.
  if (!cartRow.closedMandateJws || !cartRow.approvedBy) {
    return { ok: false, httpStatus: 422, error: 'closed_mandate_missing', message: 'No closed mandate for this cart.' };
  }
  const closed = await deps.verifyClosedMandate(cartRow.closedMandateJws, cartRow.approvedBy, {
    openMandateJws: mandate.jws,
    cart: cartRow.cart,
  });
  if (!closed.ok) {
    return {
      ok: false,
      httpStatus: 422,
      error: 'closed_mandate_invalid',
      message: closed.message ?? 'Closed mandate failed verification.',
    };
  }

  const captured = await deps.captureOrder(paypalOrderId);
  const receiptHash = deps.computeReceiptHash({
    mandateId: order.mandateId,
    cartId: order.cartId,
    cartHash: cartRow.cartHash,
    paypalOrderId,
    captureId: captured.captureId,
  });
  const stored = await store.markCaptured(paypalOrderId, {
    status: captured.status,
    captureId: captured.captureId,
    receiptHash,
  });
  if (!stored) {
    return { ok: false, httpStatus: 409, error: 'already_captured', message: 'This order was already captured.' };
  }
  return { ok: true, paypalOrderId, captureId: captured.captureId, status: captured.status };
}
