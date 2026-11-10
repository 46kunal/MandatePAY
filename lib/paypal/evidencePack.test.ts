/** A9 unit checks. Run: npx tsx --test lib/paypal/evidencePack.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CaseDetail } from './cases';
import { buildEvidenceModel, evidenceModelToText, renderEvidencePdf } from './evidencePack';

const detail = (over: Partial<CaseDetail> = {}): CaseDetail => ({
  dispute_id: 'PP-R-1',
  capture_id: 'CAP1',
  paypal_order_id: 'ORD1',
  mandate_id: 'mnd_1',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  stage: 'INQUIRY',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  amount: { value: '89.00', currency: 'USD' },
  verdict: {
    fault: 'merchant',
    action: 'MAKE_OFFER',
    offer_type: 'REFUND',
    offer_amount: '89.00',
    confidence: 0.9,
    evidence_points: [{ claim: 'Mandate required white', source: 'mandate.constraints.required_attributes.color' }],
    reasoning: 'The cart matched the mandate.',
    needs_human: false,
  },
  analysis_status: 'analysed',
  action_taken: null,
  outcome: null,
  created_at: '2026-11-09T11:00:00.000Z',
  updated_at: '2026-11-09T11:00:00.000Z',
  mandate: {
    mandate_id: 'mnd_1',
    buyer_ref: 'buyer_demo',
    expires_at: '2026-11-16T00:00:00.000Z',
    constraints: {
      max_total: { value: '110.00', currency: 'USD' },
      categories: ['shoes'],
      required_attributes: { color: 'white', size: '10' },
      request_text: 'white trainers size 10 under $110',
    },
  },
  cart: {
    cart_id: 'cart_1',
    total_minor: 8900,
    approved_by: 'agent',
    cart: {
      currency: 'USD',
      merchant: 'Demo Shoes',
      items: [{ sku: 'TR-W-10', name: 'White trainers', quantity: 1, unit_price: '89.00', attributes: { color: 'white', size: '10' } }],
    },
    guard: { verdict: 'allow', checks: [{ rule: 'max_total', status: 'pass', detail: 'Total 89.00 is within the limit.' }] },
  },
  order: {
    paypal_order_id: 'ORD1',
    status: 'COMPLETED',
    capture_id: 'CAP1',
    receipt_hash: 'sha256:abc',
    captured_at: '2026-11-09T10:51:42.632Z',
    payment_source: 'paypal',
    payer_check: 'match',
  },
  ...over,
});

describe('buildEvidenceModel', () => {
  it('includes the payment record, mandate, cart, guard checks and analysis', () => {
    const text = evidenceModelToText(buildEvidenceModel(detail(), new Date('2026-11-09T12:00:00Z')));
    for (const expected of [
      'PP-R-1', 'ORD1', 'CAP1', 'sha256:abc', 'Paid with: PayPal account',
      'The PayPal account that paid is the one the buyer linked to MandatePay', 'mnd_1', 'Maximum total: 110.00 USD', 'color = white, size = 10',
      'white trainers size 10 under $110', 'cart_1', 'Total: 89.00 USD', 'color=white, size=10', 'max_total | pass',
      'Assessed fault: merchant', 'mandate.constraints.required_attributes.color',
    ]) {
      assert.ok(text.includes(expected), `missing: ${expected}`);
    }
  });

  it('never includes signed tokens or secrets', () => {
    const text = evidenceModelToText(buildEvidenceModel(detail()));
    assert.ok(!/eyJ|secret|jws/i.test(text));
  });

  it('explains when the dispute is not linked to one of our orders', () => {
    const text = evidenceModelToText(buildEvidenceModel(detail({ mandate: null, cart: null, order: null, verdict: null })));
    assert.match(text, /not linked to one of our orders/);
  });
});

describe('renderEvidencePdf', () => {
  it('produces a real PDF', async () => {
    const pdf = await renderEvidencePdf(buildEvidenceModel(detail()));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.length > 1500);
    assert.match(pdf.subarray(-16).toString(), /%%EOF/);
  });

  it('copes with a long table without throwing', async () => {
    const items = Array.from({ length: 80 }, (_, i) => ({ sku: `S${i}`, name: `Item ${i}`, quantity: 1, unit_price: '1.00' }));
    const d = detail();
    d.cart = { ...d.cart!, cart: { currency: 'USD', merchant: 'M', items } };
    const pdf = await renderEvidencePdf(buildEvidenceModel(d));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });
});
