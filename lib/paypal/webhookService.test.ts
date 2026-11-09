/** A8 unit checks. Run: npx tsx --test lib/paypal/webhookService.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { disputeOutcome, type CaseUpsert, type DisputeStore } from './disputeService';
import type { RawDispute } from './disputes';
import { handleWebhook, type WebhookDeps } from './webhookService';

const dispute = (over: Partial<RawDispute> = {}): RawDispute => ({
  dispute_id: 'PP-R-1',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  dispute_life_cycle_stage: 'INQUIRY',
  dispute_amount: { currency_code: 'USD', value: '89.00' },
  disputed_transactions: [{ seller_transaction_id: 'CAP1' }],
  update_time: '2026-11-09T11:00:00Z',
  ...over,
});

function setup(opts: { verified?: boolean; dispute?: RawDispute } = {}) {
  const events = new Set<string>();
  const cases = new Map<string, CaseUpsert>();
  const shown: string[] = [];
  const store: DisputeStore = {
    hasEvent: async (id) => events.has(id),
    insertEvent: async (e) => void events.add(e.eventId),
    markEventProcessed: async () => {},
    caseExists: async (id) => cases.has(id),
    upsertCase: async (row) => void cases.set(row.disputeId, row),
    findOrderByCapture: async (c) => (c === 'CAP1' ? { paypalOrderId: 'O1', mandateId: 'mnd_1', captureId: c } : undefined),
  };
  const deps: WebhookDeps = {
    store,
    verify: async () => opts.verified ?? true,
    showDispute: async (id) => {
      shown.push(id);
      return opts.dispute ?? dispute();
    },
  };
  return { deps, events, cases, shown };
}

const body = (over: object = {}) =>
  JSON.stringify({ id: 'WH-1', event_type: 'CUSTOMER.DISPUTE.CREATED', resource: { dispute_id: 'PP-R-1' }, ...over });
const headers = new Headers();

describe('handleWebhook', () => {
  it('400 on a bad signature and stores nothing', async () => {
    const s = setup({ verified: false });
    const r = await handleWebhook(s.deps, headers, body());
    assert.deepEqual([r.ok, !r.ok && r.httpStatus, !r.ok && r.error], [false, 400, 'bad_signature']);
    assert.equal(s.events.size, 0);
    assert.equal(s.shown.length, 0);
  });

  it('400 on invalid JSON', async () => {
    const r = await handleWebhook(setup().deps, headers, 'not json');
    assert.equal(!r.ok && r.httpStatus, 400);
  });

  it('ingests a dispute event by re-fetching the dispute, linked to our order', async () => {
    const s = setup();
    const r = await handleWebhook(s.deps, headers, body());
    assert.deepEqual(r, { ok: true, handled: 'processed', disputeId: 'PP-R-1' });
    assert.deepEqual(s.shown, ['PP-R-1']);
    assert.equal(s.cases.get('PP-R-1')!.mandateId, 'mnd_1');
    assert.ok(s.events.has('webhook:WH-1'));
  });

  it('a retried delivery of the same event is a duplicate', async () => {
    const s = setup();
    await handleWebhook(s.deps, headers, body());
    const again = await handleWebhook(s.deps, headers, body());
    assert.equal(again.ok && again.handled, 'duplicate');
    assert.equal(s.shown.length, 1);
  });

  it('ignores events that are not dispute events', async () => {
    const s = setup();
    const r = await handleWebhook(s.deps, headers, body({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }));
    assert.deepEqual(r, { ok: true, handled: 'ignored' });
    assert.equal(s.shown.length, 0);
  });

  it('records the outcome when the dispute is resolved', async () => {
    const s = setup({
      dispute: dispute({
        status: 'RESOLVED',
        dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: { currency_code: 'USD', value: '89.00' } },
      }),
    });
    await handleWebhook(s.deps, headers, body({ event_type: 'CUSTOMER.DISPUTE.RESOLVED' }));
    assert.equal(s.cases.get('PP-R-1')!.outcome, 'RESOLVED_BUYER_FAVOUR (refunded 89.00 USD)');
  });
});

describe('disputeOutcome', () => {
  it('is null while open, the code when resolved, and RESOLVED when PayPal gives no code', () => {
    assert.equal(disputeOutcome({ status: 'OPEN' }), null);
    assert.equal(
      disputeOutcome({ status: 'RESOLVED', dispute_outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR' } }),
      'RESOLVED_SELLER_FAVOUR',
    );
    assert.equal(disputeOutcome({ status: 'RESOLVED' }), 'RESOLVED');
  });
});
