/** B5/B6/B8 checks. Run: npx tsx --test lib/mandate/guard.test.ts. Uses a temp key directory. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Cart, Constraints } from '../../contracts/schemas';
import { checkCart } from './check';
import { computeReceiptHash, createClosedMandate, hashCart, verifyClosedMandate } from './closed';
import { evaluateCart } from './guard';
import { signOpenMandate } from './jws';
import { resetKeyCache } from './keys';

const NOW = 1_800_000_000;

const constraints: Constraints = {
  max_total: { value: '110.00', currency: 'GBP' },
  categories: ['shoes'],
  max_quantity: 2,
  required_attributes: { color: 'white', size: '10' },
  deadline: '2027-01-31T00:00:00Z',
  require_approval_over: '100.00',
};

function cart(overrides: Partial<Cart['items'][number]> = {}, extra: Partial<Cart> = {}): Cart {
  return {
    currency: 'GBP',
    delivery_eta: '2027-01-20T00:00:00Z',
    items: [
      { sku: 'sku1', name: 'White trainers', category: 'shoes', quantity: 1, unit_price: '89.99', attributes: { color: 'White', size: '10' }, ...overrides },
    ],
    ...extra,
  };
}

const status = (c: Constraints, k: Cart, rule: string) => evaluateCart(c, k).checks.find((x) => x.rule === rule)?.status;

describe('guard rules (B5)', () => {
  it('allows a cart that satisfies everything', () => {
    const r = evaluateCart(constraints, cart());
    assert.equal(r.verdict, 'allow');
    assert.equal(r.total, '89.99');
    assert.ok(r.checks.every((c) => c.status === 'pass' && c.detail.length > 0));
  });

  it('fails max_total, using exact minor-unit arithmetic', () => {
    assert.equal(status(constraints, cart({ unit_price: '110.01' }), 'max_total'), 'fail');
    assert.equal(status(constraints, cart({ unit_price: '110.00' }), 'max_total'), 'pass');
    // 0.1 + 0.2 style rounding traps
    assert.equal(evaluateCart({ ...constraints, max_total: { value: '0.30', currency: 'GBP' } }, cart({ unit_price: '0.10', quantity: 3 })).total, '0.30');
  });

  it('fails a different currency', () => {
    assert.equal(status(constraints, cart({}, { currency: 'USD' }), 'max_total'), 'fail');
  });

  it('fails the wrong category and is unsure when the category is missing', () => {
    assert.equal(status(constraints, cart({ category: 'hats' }), 'categories'), 'fail');
    assert.equal(status(constraints, cart({ category: undefined }), 'categories'), 'unsure');
    assert.equal(evaluateCart(constraints, cart({ category: undefined })).verdict, 'escalate');
  });

  it('fails when total quantity is over the limit', () => {
    assert.equal(status(constraints, cart({ quantity: 3, unit_price: '10.00' }), 'max_quantity'), 'fail');
  });

  it('fails a wrong attribute: within budget but the wrong product', () => {
    const r = evaluateCart(constraints, cart({ attributes: { color: 'black', size: '10' } }));
    assert.equal(r.verdict, 'block');
    assert.equal(r.checks.find((c) => c.rule === 'required_attributes')?.status, 'fail');
    assert.equal(r.checks.find((c) => c.rule === 'max_total')?.status, 'pass');
  });

  it('is unsure when a required attribute is missing', () => {
    assert.equal(status(constraints, cart({ attributes: { color: 'white' } }), 'required_attributes'), 'unsure');
  });

  it('checks the deadline', () => {
    assert.equal(status(constraints, cart({}, { delivery_eta: '2027-02-05T00:00:00Z' }), 'deadline'), 'fail');
    assert.equal(status(constraints, cart({}, { delivery_eta: null }), 'deadline'), 'unsure');
  });

  it('escalates over the approval threshold, and the mandate threshold beats the default', () => {
    const r = evaluateCart(constraints, cart({ unit_price: '105.00' }));
    assert.equal(r.verdict, 'escalate');
    assert.equal(evaluateCart({ ...constraints, require_approval_over: undefined }, cart({ unit_price: '105.00' }), { approvalThreshold: '200.00' }).verdict, 'allow');
    assert.equal(evaluateCart({ ...constraints, require_approval_over: '500.00' }, cart({ unit_price: '105.00' }), { approvalThreshold: '10.00' }).verdict, 'allow');
  });

  it('a fail always wins over escalate', () => {
    const r = evaluateCart(constraints, cart({ unit_price: '109.00', category: 'hats' }));
    assert.equal(r.verdict, 'block');
  });
});

describe('cart check and closed mandate (B6, B8)', () => {
  let keyDir: string;
  before(async () => {
    keyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mandatepay-guard-'));
    resetKeyCache();
  });
  after(async () => {
    resetKeyCache();
    await fs.rm(keyDir, { recursive: true, force: true });
  });

  const open = (exp = NOW + 3600) =>
    signOpenMandate({ typ: 'checkout_mandate.open', mandate_id: 'mnd_1', buyer_ref: 'b1', constraints, iat: NOW, exp }, { keyDir });

  it('checks a cart against a verified mandate', async () => {
    const r = await checkCart(await open(), cart(), { keyDir, now: NOW, approvalThreshold: '100.00' });
    assert.ok(r.ok);
    assert.equal(r.guard.verdict, 'allow');
  });

  it('returns 410 for an expired mandate', async () => {
    const r = await checkCart(await open(NOW - 1), cart(), { keyDir, now: NOW, approvalThreshold: '100.00' });
    assert.ok(!r.ok);
    assert.equal(r.status, 410);
  });

  it('rejects a tampered mandate instead of trusting its constraints', async () => {
    const jws = await open();
    const [h, , s] = jws.split('.');
    const forged = Buffer.from(JSON.stringify({ typ: 'checkout_mandate.open', mandate_id: 'mnd_1', buyer_ref: 'b1', constraints: { max_total: { value: '9999.00', currency: 'GBP' } }, iat: NOW, exp: NOW + 3600 })).toString('base64url');
    const r = await checkCart(`${h}.${forged}.${s}`, cart(), { keyDir, now: NOW, approvalThreshold: '100.00' });
    assert.ok(!r.ok);
    assert.equal(r.status, 422);
  });

  it('creates and verifies a closed mandate bound to the open mandate and cart', async () => {
    const openJws = await open();
    const c = cart();
    for (const approvedBy of ['buyer', 'agent'] as const) {
      const closed = await createClosedMandate({ mandateId: 'mnd_1', openMandateJws: openJws, cart: c, approvedBy, now: NOW }, { keyDir });
      assert.equal(closed.payload.total, '89.99');
      const ok = await verifyClosedMandate(closed.jws, approvedBy, { openMandateJws: openJws, cart: c }, { keyDir });
      assert.ok(ok.ok);
    }
  });

  it('rejects a closed mandate checked against a different cart, open mandate, or key role', async () => {
    const openJws = await open();
    const closed = await createClosedMandate({ mandateId: 'mnd_1', openMandateJws: openJws, cart: cart(), approvedBy: 'agent', now: NOW }, { keyDir });
    const otherCart = await verifyClosedMandate(closed.jws, 'agent', { cart: cart({ unit_price: '1.00' }) }, { keyDir });
    assert.ok(!otherCart.ok && otherCart.reason === 'mismatch');
    const otherOpen = await verifyClosedMandate(closed.jws, 'agent', { openMandateJws: await open(NOW + 9999) }, { keyDir });
    assert.ok(!otherOpen.ok && otherOpen.reason === 'mismatch');
    const wrongRole = await verifyClosedMandate(closed.jws, 'buyer', {}, { keyDir });
    assert.ok(!wrongRole.ok && wrongRole.reason === 'bad_signature');
  });

  it('hashes carts canonically and computes a stable receipt hash', () => {
    const a = cart();
    const b = JSON.parse(JSON.stringify({ items: a.items, delivery_eta: a.delivery_eta, currency: a.currency })) as Cart;
    assert.equal(hashCart(a), hashCart(b));
    const input = { mandateId: 'mnd_1', cartId: 'cart_1', cartHash: hashCart(a), paypalOrderId: 'ord', captureId: 'cap' };
    assert.equal(computeReceiptHash(input), computeReceiptHash({ ...input }));
    assert.notEqual(computeReceiptHash(input), computeReceiptHash({ ...input, captureId: 'cap2' }));
    assert.match(computeReceiptHash(input), /^sha256:[0-9a-f]{64}$/);
  });
});
