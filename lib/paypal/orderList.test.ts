/** Order list mapping. Run: npx tsx --test lib/paypal/orderList.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OrderSummary } from '../../contracts/schemas';
import { toOrderSummary, type OrderListRow } from './orderList';

const row = (over: Partial<OrderListRow> = {}): OrderListRow => ({
  paypalOrderId: '5LR80912DJ052735Y',
  cartId: 'cart_1',
  mandateId: 'mnd_1',
  status: 'COMPLETED',
  captureId: '7N507458YD337112V',
  receiptHash: 'abc',
  createdAt: new Date('2026-11-09T18:01:35Z'),
  capturedAt: new Date('2026-11-09T18:10:00Z'),
  totalMinor: 1400,
  currency: 'USD',
  cart: { currency: 'USD', items: [{ sku: 'SK-WHT-M', name: 'Cushion Run Socks', quantity: 1, unit_price: '14.00' }] },
  disputeId: null,
  ...over,
});

describe('toOrderSummary', () => {
  it('maps a paid order without a dispute to the contract shape', () => {
    const o = toOrderSummary(row());
    assert.ok(OrderSummary.safeParse(o).success);
    assert.equal(o.total, '14.00');
    assert.deepEqual(o.items, [{ name: 'Cushion Run Socks', quantity: 1 }]);
    assert.equal(o.captured_at, '2026-11-09T18:10:00.000Z');
    assert.equal('dispute_id' in o, false);
  });

  it('an unpaid order has no capture fields; a disputed one carries the dispute id', () => {
    const unpaid = toOrderSummary(row({ status: 'PAYER_ACTION_REQUIRED', captureId: null, receiptHash: null, capturedAt: null }));
    assert.ok(OrderSummary.safeParse(unpaid).success);
    assert.equal('capture_id' in unpaid, false);
    assert.equal(toOrderSummary(row({ disputeId: 'PP-D-1' })).dispute_id, 'PP-D-1');
  });
});
