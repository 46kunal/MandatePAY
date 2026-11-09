/**
 * Shape of a REAL sandbox dispute (recorded 2026-11-09, ids and personal data replaced). Run: npx tsx --test lib/paypal/realDispute.test.ts
 * Verified against the sandbox: disputed_transactions[0].seller_transaction_id equals our orders.capture_id.
 * While the dispute is UNDER_PAYPAL_REVIEW PayPal returns only a `self` link and no allowed_response_options,
 * so the merchant can take no action yet.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toCaseRecord } from './cases';
import { ingestDispute, type CaseUpsert, type DisputeStore } from './disputeService';
import { toDisputeSummary, type RawDispute } from './disputes';

const real: RawDispute = {
  dispute_id: 'PP-R-XXX-00000000',
  create_time: '2026-11-09T11:02:03.675Z',
  update_time: '2026-11-09T11:04:53.732Z',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  status: 'UNDER_REVIEW',
  dispute_life_cycle_stage: 'INQUIRY',
  dispute_amount: { currency_code: 'USD', value: '89.00' },
  disputed_transactions: [
    { seller_transaction_id: 'CAPTURE-ID-1', buyer_transaction_id: 'BUYER-TX-1', custom: 'mnd_1', invoice_number: 'cart_1' } as never,
  ],
  messages: [{ posted_by: 'BUYER', content: 'The pair I received is a different model.', time_posted: '2026-11-09T11:02:03.675Z' }],
  links: [{ rel: 'self', href: 'https://api.sandbox.paypal.com/v1/customer/disputes/PP-R-XXX-00000000', method: 'GET' }],
};

describe('real sandbox dispute shape', () => {
  it('maps to a summary with the capture id and only NO_ACTION while under PayPal review', () => {
    const s = toDisputeSummary(real);
    assert.equal(s.seller_transaction_id, 'CAPTURE-ID-1');
    assert.deepEqual(s.allowed_actions, ['NO_ACTION']);
    assert.deepEqual(s.offer_types, []);
    assert.equal(s.stage, 'INQUIRY');
    assert.equal(s.messages[0].from, 'BUYER');
  });

  it('links to our order through seller_transaction_id', async () => {
    const cases = new Map<string, CaseUpsert>();
    const store: DisputeStore = {
      hasEvent: async () => false,
      insertEvent: async () => {},
      markEventProcessed: async () => {},
      caseExists: async () => false,
      upsertCase: async (row) => void cases.set(row.disputeId, row),
      findOrderByCapture: async (id) => (id === 'CAPTURE-ID-1' ? { paypalOrderId: 'O1', mandateId: 'mnd_1', captureId: id } : undefined),
    };
    const r = await ingestDispute(store, real, 'poll');
    assert.equal(r.linked, true);
    const row = cases.get(real.dispute_id)!;
    assert.equal(row.mandateId, 'mnd_1');
    assert.equal(row.amountMinor, 8900);
    assert.equal(toCaseRecord({ ...row, amountMinor: row.amountMinor, verdict: null, analysisStatus: 'pending', actionTaken: null, outcome: null, createdAt: new Date(0), updatedAt: new Date(0) }).stage, 'INQUIRY');
  });
});
