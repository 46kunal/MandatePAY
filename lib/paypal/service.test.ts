/**
 * A2 unit checks. Run: npx tsx --test lib/paypal/service.test.ts
 * Uses B's real mandate signing and guard (temp key dir, fuzzy matching off), an in-memory ledger and a fake PayPal.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import type { Cart, Constraints } from '../../contracts/schemas';
import { checkCart, computeReceiptHash, createClosedMandate, hashCart, signOpenMandate, verifyClosedMandate } from '../mandate';
import type { CapturedOrder, CreateOrderInput } from './orders';
import { captureStoredOrder, placeOrder, type CartRow, type LedgerStore, type MandateRow, type OrderDeps, type OrderRow } from './service';

const keyDir = mkdtempSync(path.join(tmpdir(), 'mandatepay-a2-'));
after(() => rmSync(keyDir, { recursive: true, force: true }));

const NOW = Math.floor(Date.now() / 1000);

function memoryStore() {
  const mandates = new Map<string, MandateRow>();
  const carts = new Map<string, CartRow>();
  const orders = new Map<string, OrderRow>();
  const store: LedgerStore = {
    getMandate: async (id) => mandates.get(id),
    getCart: async (id) => carts.get(id),
    getOrder: async (id) => orders.get(id),
    insertCart: async (r) => void carts.set(r.cartId, r),
    insertOrder: async (r) => void orders.set(r.paypalOrderId, r),
    markCaptured: async (id, f) => {
      const o = orders.get(id);
      if (!o || o.captureId) return false;
      orders.set(id, { ...o, status: f.status, captureId: f.captureId, receiptHash: f.receiptHash });
      return true;
    },
  };
  return { store, mandates, carts, orders };
}

async function setup(constraints: Constraints, opts: { exp?: number } = {}) {
  const ledger = memoryStore();
  const mandateId = 'mnd_test0001';
  const jws = await signOpenMandate(
    { typ: 'checkout_mandate.open', mandate_id: mandateId, buyer_ref: 'buyer-1', constraints, iat: NOW, exp: opts.exp ?? NOW + 3600 },
    { keyDir },
  );
  ledger.mandates.set(mandateId, { mandateId, jws });

  const paypal = { created: [] as CreateOrderInput[], captured: [] as string[], failCreate: false };
  const deps: OrderDeps = {
    store: ledger.store,
    checkCart: (j, cart) => checkCart(j, cart, { keyDir, fuzzy: false, approvalThreshold: '100.00' }),
    hashCart,
    createClosedMandate: (i) => createClosedMandate(i, { keyDir }),
    verifyClosedMandate: (j, by, expected) => verifyClosedMandate(j, by, expected, { keyDir }),
    computeReceiptHash,
    createOrder: async (input) => {
      if (paypal.failCreate) throw new Error('paypal down');
      paypal.created.push(input);
      return { paypalOrderId: `ORDER${paypal.created.length}`, status: 'PAYER_ACTION_REQUIRED', approveUrl: 'https://sandbox.paypal.com/x' };
    },
    captureOrder: async (id): Promise<CapturedOrder> => {
      paypal.captured.push(id);
      return { paypalOrderId: id, captureId: `CAP-${id}`, status: 'COMPLETED', captureStatus: 'COMPLETED' };
    },
    newCartId: () => `cart_${ledger.carts.size + 1}`,
  };
  return { ...ledger, deps, mandateId, jws, paypal };
}

const constraints: Constraints = {
  max_total: { value: '120.00', currency: 'GBP' },
  required_attributes: { color: 'white' },
};
const goodCart: Cart = {
  currency: 'GBP',
  items: [{ sku: 'S1', name: 'White trainers', quantity: 1, unit_price: '50.00', attributes: { color: 'white' } }],
};
const wrongColourCart: Cart = {
  currency: 'GBP',
  items: [{ sku: 'S1', name: 'Black trainers', quantity: 1, unit_price: '50.00', attributes: { color: 'black' } }],
};
const overThresholdCart: Cart = {
  currency: 'GBP',
  items: [{ sku: 'S1', name: 'White trainers', quantity: 1, unit_price: '110.00', attributes: { color: 'white' } }],
};

describe('placeOrder', () => {
  it('creates a PayPal order for an allowed cart, signed by the agent, bound to mandate and cart', async () => {
    const t = await setup(constraints);
    const r = await placeOrder(t.deps, { mandateId: t.mandateId, cart: goodCart, buyerApproved: false });
    assert.ok(r.ok && r.status === 'created');
    assert.equal(r.paypalOrderId, 'ORDER1');
    assert.equal(t.paypal.created[0].mandateId, t.mandateId);
    assert.equal(t.paypal.created[0].cartId, r.cartId);

    const cart = t.carts.get(r.cartId)!;
    assert.equal(cart.approvedBy, 'agent');
    assert.ok(cart.closedMandateJws);
    assert.equal(cart.totalMinor, 5000);
    assert.equal(cart.cartHash, hashCart(goodCart));
    assert.equal(t.orders.get('ORDER1')!.cartId, r.cartId);
  });

  it('blocks a cart that violates the mandate: 422, recorded, never sent to PayPal', async () => {
    const t = await setup(constraints);
    const r = await placeOrder(t.deps, { mandateId: t.mandateId, cart: wrongColourCart, buyerApproved: true });
    assert.ok(!r.ok);
    assert.equal(r.httpStatus, 422);
    assert.equal(r.error, 'guard_blocked');
    assert.equal(t.paypal.created.length, 0);
    assert.equal(t.orders.size, 0);
    const [row] = [...t.carts.values()];
    assert.equal(row.guard.verdict, 'block');
    assert.equal(row.closedMandateJws, null);
  });

  it('a buyer_approved flag cannot override a block', async () => {
    const t = await setup(constraints);
    const r = await placeOrder(t.deps, { mandateId: t.mandateId, cart: wrongColourCart, buyerApproved: true });
    assert.ok(!r.ok && r.error === 'guard_blocked');
  });

  it('asks for approval when the cart is over the threshold and the buyer has not clicked', async () => {
    const t = await setup(constraints);
    const r = await placeOrder(t.deps, { mandateId: t.mandateId, cart: overThresholdCart, buyerApproved: false });
    assert.ok(r.ok && r.status === 'needs_approval');
    assert.equal(r.guard.verdict, 'escalate');
    assert.equal(t.paypal.created.length, 0);
    assert.equal([...t.carts.values()][0].closedMandateJws, null);
  });

  it('proceeds once the buyer approves, and the closed mandate is signed by the buyer', async () => {
    const t = await setup(constraints);
    const r = await placeOrder(t.deps, { mandateId: t.mandateId, cart: overThresholdCart, buyerApproved: true });
    assert.ok(r.ok && r.status === 'created');
    assert.equal(t.carts.get(r.cartId)!.approvedBy, 'buyer');
  });

  it('returns 404 for an unknown mandate and 410 for an expired one', async () => {
    const t = await setup(constraints);
    const missing = await placeOrder(t.deps, { mandateId: 'mnd_nope', cart: goodCart, buyerApproved: false });
    assert.ok(!missing.ok && missing.httpStatus === 404);

    const expired = await setup(constraints, { exp: NOW - 10 });
    const r = await placeOrder(expired.deps, { mandateId: expired.mandateId, cart: goodCart, buyerApproved: false });
    assert.ok(!r.ok && r.httpStatus === 410);
    assert.equal(expired.paypal.created.length, 0);
  });

  it('rejects a tampered mandate token', async () => {
    const t = await setup(constraints);
    const m = t.mandates.get(t.mandateId)!;
    const [h, , s] = m.jws.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ typ: 'checkout_mandate.open' })).toString('base64url');
    t.mandates.set(t.mandateId, { ...m, jws: `${h}.${forgedPayload}.${s}` });
    const r = await placeOrder(t.deps, { mandateId: t.mandateId, cart: goodCart, buyerApproved: false });
    assert.ok(!r.ok && r.httpStatus === 422 && r.error === 'mandate_invalid');
    assert.equal(t.paypal.created.length, 0);
  });

  it('propagates a PayPal failure and creates no order row', async () => {
    const t = await setup(constraints);
    t.paypal.failCreate = true;
    await assert.rejects(placeOrder(t.deps, { mandateId: t.mandateId, cart: goodCart, buyerApproved: false }), /paypal down/);
    assert.equal(t.orders.size, 0);
  });
});

describe('captureStoredOrder', () => {
  async function placed() {
    const t = await setup(constraints);
    const r = await placeOrder(t.deps, { mandateId: t.mandateId, cart: goodCart, buyerApproved: false });
    assert.ok(r.ok && r.status === 'created');
    return { t, orderId: r.paypalOrderId, cartId: r.cartId };
  }

  it('captures, stores capture_id and a receipt hash that matches B\'s formula', async () => {
    const { t, orderId, cartId } = await placed();
    const r = await captureStoredOrder(t.deps, orderId);
    assert.ok(r.ok);
    assert.equal(r.captureId, `CAP-${orderId}`);
    const row = t.orders.get(orderId)!;
    assert.equal(row.captureId, `CAP-${orderId}`);
    assert.equal(
      row.receiptHash,
      computeReceiptHash({ mandateId: t.mandateId, cartId, cartHash: hashCart(goodCart), paypalOrderId: orderId, captureId: row.captureId! }),
    );
  });

  it('returns 409 on a second capture without calling PayPal again', async () => {
    const { t, orderId } = await placed();
    await captureStoredOrder(t.deps, orderId);
    const again = await captureStoredOrder(t.deps, orderId);
    assert.ok(!again.ok && again.httpStatus === 409);
    assert.equal(t.paypal.captured.length, 1);
  });

  it('returns 404 for an unknown order', async () => {
    const t = await setup(constraints);
    const r = await captureStoredOrder(t.deps, 'NOPE');
    assert.ok(!r.ok && r.httpStatus === 404);
  });

  it('refuses to capture when the stored cart no longer matches its closed mandate', async () => {
    const { t, orderId, cartId } = await placed();
    const row = t.carts.get(cartId)!;
    t.carts.set(cartId, { ...row, cart: { ...row.cart, items: [{ ...row.cart.items[0], unit_price: '99.00' }] } });
    const r = await captureStoredOrder(t.deps, orderId);
    assert.ok(!r.ok && r.httpStatus === 422 && r.error === 'closed_mandate_invalid');
    assert.equal(t.paypal.captured.length, 0);
  });

  it('refuses to capture a cart that has no closed mandate', async () => {
    const { t, orderId, cartId } = await placed();
    t.carts.set(cartId, { ...t.carts.get(cartId)!, closedMandateJws: null });
    const r = await captureStoredOrder(t.deps, orderId);
    assert.ok(!r.ok && r.error === 'closed_mandate_missing');
  });
});
