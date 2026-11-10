/** Refund awareness. Run: npx tsx --test lib/refunds.test.ts (no database, no network). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DisputeSummary, Verdict } from '../contracts/schemas';
import { OrderSummary } from '../contracts/schemas';
import { enforce, type AnalystInput } from './analyst/analyst';
import { can } from './auth/roles';
import { toOrderSummary } from './paypal/orderList';
import { parseRefunds, planRefund, refundableMinor, refundCover, refundedView, summariseRefunds, type RefundRecord } from './paypal/refunds';

/** The shape PayPal returned for the real sandbox order 3AC3197780695271A (values trimmed). */
const paypalOrder = {
  id: '3AC3197780695271A',
  status: 'COMPLETED',
  purchase_units: [
    {
      payments: {
        captures: [{ id: 'CAP1', status: 'PENDING', amount: { currency_code: 'USD', value: '89.00' } }],
        refunds: [{ id: 'RF1', status: 'PENDING', amount: { currency_code: 'USD', value: '85.40' }, create_time: '2026-11-10T12:05:00Z' }],
      },
    },
  ],
};

const rec = (over: Partial<RefundRecord>): RefundRecord => ({ id: 'R', status: 'COMPLETED', amount_minor: 1000, currency: 'USD', created_at: null, ...over });

describe('reading refunds from PayPal', () => {
  it('parses refunds off the order, amounts in minor units', () => {
    assert.deepEqual(parseRefunds(paypalOrder), [
      { id: 'RF1', status: 'PENDING', amount_minor: 8540, currency: 'USD', created_at: '2026-11-10T12:05:00Z' },
    ]);
    assert.deepEqual(parseRefunds({ purchase_units: [{ payments: {} }] }), []);
    assert.deepEqual(parseRefunds(null), []);
    assert.deepEqual(parseRefunds({ purchase_units: [{ payments: { refunds: [{ id: 'X', amount: { value: 'abc' } }] } }] }), []);
  });

  it('counts completed and pending refunds, not failed or cancelled ones', () => {
    const s = summariseRefunds([rec({ amount_minor: 500 }), rec({ status: 'PENDING', amount_minor: 300 }), rec({ status: 'FAILED', amount_minor: 9999 }), rec({ status: 'CANCELLED', amount_minor: 1 })]);
    assert.deepEqual(s, { total_minor: 800, currency: 'USD', pending: true });
  });

  it('says whether the refunds cover none, part or all of the disputed amount', () => {
    assert.equal(refundCover(0, 8900), 'none');
    assert.equal(refundCover(8540, 8900), 'partial');
    assert.equal(refundCover(8900, 8900), 'full');
    assert.equal(refundCover(9000, 8900), 'full');
    assert.equal(refundCover(100, null), 'partial');
  });

  it('the view for the real sandbox case: $85.40 pending, part of the $89.00 dispute', () => {
    assert.deepEqual(refundedView(parseRefunds(paypalOrder), 8900), { value: '85.40', currency: 'USD', pending: true, covers_dispute: 'partial' });
    assert.equal(refundedView([], 8900), null);
  });
});

describe('planning a refund', () => {
  it('defaults to everything still refundable', () => {
    assert.deepEqual(planRefund(8900, []), { ok: true, amountMinor: 8900, remainingAfterMinor: 0 });
    assert.deepEqual(planRefund(8900, [rec({ amount_minor: 8540 })]), { ok: true, amountMinor: 360, remainingAfterMinor: 0 });
  });

  it('never refunds more than is left, counting refunds made in the PayPal dashboard', () => {
    const r = planRefund(8900, [rec({ status: 'PENDING', amount_minor: 8540 })], 1000);
    assert.ok(!r.ok && r.status === 422 && r.error === 'refund_exceeds_remaining' && /3\.60/.test(r.message));
    assert.equal(refundableMinor(8900, [rec({ amount_minor: 8540 })]), 360);
  });

  it('refuses a fully refunded payment and a zero amount', () => {
    const full = planRefund(8900, [rec({ amount_minor: 8900 })]);
    assert.ok(!full.ok && full.status === 409 && full.error === 'fully_refunded');
    const zero = planRefund(8900, [], 0);
    assert.ok(!zero.ok && zero.error === 'invalid_amount');
  });

  it('a partial amount leaves the rest refundable', () => {
    assert.deepEqual(planRefund(8900, [], 2000), { ok: true, amountMinor: 2000, remainingAfterMinor: 6900 });
  });
});

describe('the analyst never refunds twice', () => {
  const dispute = (over: Partial<DisputeSummary> = {}): DisputeSummary => ({
    dispute_id: 'PP-1',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    stage: 'INQUIRY',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    amount: { value: '89.00', currency: 'USD' },
    allowed_actions: ['ACCEPT_CLAIM', 'MAKE_OFFER', 'SEND_MESSAGE', 'NO_ACTION'],
    offer_types: ['REFUND'],
    messages: [],
    ...over,
  });
  const input = (covers: 'partial' | 'full', value: string): AnalystInput => ({
    dispute: dispute(),
    mandate: { mandate_id: 'mnd_1', constraints: { max_total: { value: '110.00', currency: 'USD' } } },
    cart: { currency: 'USD', items: [{ sku: 's', name: 'Trainers', quantity: 1, unit_price: '89.00' }] },
    payment: { source: 'paypal', payer_check: 'match', mandate_signed_with: 'buyer_key', refund: { value, currency: 'USD', pending: true, covers_dispute: covers } },
  });
  const v = (over: Partial<Verdict>): Verdict => ({
    fault: 'merchant',
    action: 'MAKE_OFFER',
    offer_type: 'REFUND',
    offer_amount: '89.00',
    confidence: 0.9,
    evidence_points: [{ claim: 'Not received.', source: 'dispute.reason' }],
    reasoning: 'Refund.',
    needs_human: false,
    ...over,
  });

  it('fully refunded: an offer or accepting becomes a message, and a person decides', () => {
    for (const action of ['MAKE_OFFER', 'ACCEPT_CLAIM'] as const) {
      const out = enforce(v({ action, ...(action === 'ACCEPT_CLAIM' ? { offer_type: undefined, offer_amount: undefined } : {}) }), input('full', '89.00'));
      assert.equal(out.action, 'SEND_MESSAGE', action);
      assert.equal(out.offer_amount, undefined);
      assert.equal(out.needs_human, true);
      assert.match(out.reasoning, /already refunded 89\.00 USD/);
    }
  });

  it('partly refunded: an offer is capped at what is still owed', () => {
    const out = enforce(v({}), input('partial', '85.40'));
    assert.equal(out.action, 'MAKE_OFFER');
    assert.equal(out.offer_amount, '3.60');
    assert.equal(out.needs_human, true);
  });

  it('partly refunded: accepting the claim needs a person', () => {
    const out = enforce(v({ action: 'ACCEPT_CLAIM', offer_type: undefined, offer_amount: undefined }), input('partial', '85.40'));
    assert.equal(out.action, 'ACCEPT_CLAIM');
    assert.equal(out.needs_human, true);
    assert.match(out.reasoning, /may refund the buyer again/);
  });
});

describe('orders and permissions', () => {
  it('the order list shows what was refunded', () => {
    const o = toOrderSummary({
      paypalOrderId: 'O1',
      cartId: 'c1',
      mandateId: 'm1',
      status: 'COMPLETED',
      captureId: 'CAP1',
      receiptHash: null,
      createdAt: new Date('2026-11-10T00:00:00Z'),
      capturedAt: new Date('2026-11-10T00:01:00Z'),
      totalMinor: 8900,
      currency: 'USD',
      cart: { currency: 'USD', items: [{ sku: 's', name: 'Trainers', quantity: 1, unit_price: '89.00' }] },
      disputeId: null,
      refunds: parseRefunds(paypalOrder),
    });
    assert.ok(OrderSummary.safeParse(o).success);
    assert.equal(o.refunded, '85.40');
    assert.equal(o.refund_pending, true);
  });

  it('only owners and admins can refund', () => {
    assert.ok(can('owner', 'orders:refund') && can('admin', 'orders:refund'));
    assert.ok(!can('staff', 'orders:refund') && !can('buyer', 'orders:refund'));
  });
});
