/**
 * A3a unit checks. Run: npx tsx --test lib/paypal/disputeService.test.ts
 * In-memory stores and a scripted PayPal: no Postgres, no network.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { toCaseRecord } from './cases';
import { disputeEventId, ingestDispute, pollDisputes, type CaseUpsert, type DisputeStore, type LinkedOrder } from './disputeService';
import type { RawDispute } from './disputes';

function memoryStore(orders: LinkedOrder[] = []) {
  const events = new Map<string, { processed: boolean; source: string }>();
  const cases = new Map<string, CaseUpsert & { verdict?: unknown; analysisStatus: string }>();
  const store: DisputeStore = {
    hasEvent: async (id) => events.has(id),
    insertEvent: async (e) => void events.set(e.eventId, { processed: false, source: e.source }),
    markEventProcessed: async (id) => void (events.get(id)!.processed = true),
    caseExists: async (id) => cases.has(id),
    upsertCase: async (row) => {
      const prev = cases.get(row.disputeId);
      // mirrors the SQL: only PayPal-derived fields change, analysis state is kept
      cases.set(row.disputeId, { analysisStatus: 'pending', ...prev, ...row });
    },
    findOrderByCapture: async (cap) => orders.find((o) => o.captureId === cap),
  };
  return { store, events, cases };
}

const dispute = (over: Partial<RawDispute> = {}): RawDispute => ({
  dispute_id: 'PP-D-1',
  reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  status: 'WAITING_FOR_SELLER_RESPONSE',
  dispute_life_cycle_stage: 'INQUIRY',
  dispute_amount: { currency_code: 'USD', value: '93.25' },
  disputed_transactions: [{ seller_transaction_id: 'CAP1' }],
  update_time: '2026-11-07T10:00:00Z',
  ...over,
});

const ourOrder: LinkedOrder = { paypalOrderId: 'ORDER1', mandateId: 'mnd_1', captureId: 'CAP1' };

describe('ingestDispute', () => {
  it('creates a case linked to our order by capture id', async () => {
    const m = memoryStore([ourOrder]);
    const r = await ingestDispute(m.store, dispute(), 'poll');
    assert.deepEqual(r, { processed: true, isNew: true, linked: true });
    const c = m.cases.get('PP-D-1')!;
    assert.equal(c.paypalOrderId, 'ORDER1');
    assert.equal(c.mandateId, 'mnd_1');
    assert.equal(c.captureId, 'CAP1');
    assert.equal(c.amountMinor, 9325);
    assert.equal(c.currency, 'USD');
    assert.equal(c.stage, 'INQUIRY');
    assert.equal(m.events.get(disputeEventId(dispute()))!.processed, true);
  });

  it('keeps a case for a dispute we cannot link (not ours, or an id mismatch) instead of dropping it', async () => {
    const m = memoryStore([]);
    const r = await ingestDispute(m.store, dispute(), 'poll');
    assert.deepEqual(r, { processed: true, isNew: true, linked: false });
    assert.equal(m.cases.get('PP-D-1')!.mandateId, null);
  });

  it('is idempotent: the same change is processed once', async () => {
    const m = memoryStore([ourOrder]);
    await ingestDispute(m.store, dispute(), 'poll');
    const again = await ingestDispute(m.store, dispute(), 'webhook');
    assert.equal(again.processed, false);
    assert.equal(m.events.size, 1);
  });

  it('a later change updates the case but keeps the verdict and analysis status', async () => {
    const m = memoryStore([ourOrder]);
    await ingestDispute(m.store, dispute(), 'poll');
    Object.assign(m.cases.get('PP-D-1')!, { verdict: { fault: 'merchant' }, analysisStatus: 'analysed' });

    const r = await ingestDispute(m.store, dispute({ update_time: '2026-11-08T09:00:00Z', status: 'UNDER_REVIEW' }), 'poll');
    assert.equal(r.isNew, false);
    const c = m.cases.get('PP-D-1')!;
    assert.equal(c.status, 'UNDER_REVIEW');
    assert.deepEqual(c.verdict, { fault: 'merchant' });
    assert.equal(c.analysisStatus, 'analysed');
  });

  it('tolerates a sparse dispute', async () => {
    const m = memoryStore();
    const r = await ingestDispute(m.store, { dispute_id: 'PP-D-9' }, 'poll');
    assert.equal(r.processed, true);
    const c = m.cases.get('PP-D-9')!;
    assert.equal(c.amountMinor, null);
    assert.equal(c.captureId, null);
  });
});

describe('pollDisputes', () => {
  function pollWith(m: ReturnType<typeof memoryStore>, items: RawDispute[]) {
    const shown: string[] = [];
    return {
      shown,
      deps: {
        store: m.store,
        listDisputes: async () => items.map(({ dispute_id, status, update_time }) => ({ dispute_id, status, update_time })),
        showDispute: async (id: string) => {
          shown.push(id);
          return items.find((d) => d.dispute_id === id)!;
        },
      },
    };
  }

  it('counts fetched, new and linked cases', async () => {
    const m = memoryStore([ourOrder]);
    const { deps } = pollWith(m, [
      dispute(),
      dispute({ dispute_id: 'PP-D-2', disputed_transactions: [{ seller_transaction_id: 'OTHER' }] }),
    ]);
    assert.deepEqual(await pollDisputes(deps), { fetched: 2, newCases: 2, linked: 1 });
  });

  it('polling twice does not refetch unchanged disputes or create duplicates', async () => {
    const m = memoryStore([ourOrder]);
    const { deps, shown } = pollWith(m, [dispute()]);
    await pollDisputes(deps);
    const second = await pollDisputes(deps);
    assert.deepEqual(second, { fetched: 1, newCases: 0, linked: 0 });
    assert.equal(shown.length, 1);
    assert.equal(m.cases.size, 1);
  });

  it('handles an empty dispute list', async () => {
    const m = memoryStore();
    assert.deepEqual(await pollDisputes(pollWith(m, []).deps), { fetched: 0, newCases: 0, linked: 0 });
  });
});

describe('toCaseRecord', () => {
  it('maps a row to the CaseRecord contract', () => {
    const rec = toCaseRecord({
      disputeId: 'PP-D-1',
      captureId: 'CAP1',
      paypalOrderId: 'ORDER1',
      mandateId: 'mnd_1',
      reason: 'R',
      stage: 'INQUIRY',
      status: 'OPEN',
      amountMinor: 9325,
      currency: 'USD',
      verdict: null,
      analysisStatus: 'pending',
      actionTaken: null,
      outcome: null,
      createdAt: new Date('2026-11-07T10:00:00Z'),
      updatedAt: new Date('2026-11-07T11:00:00Z'),
    });
    assert.deepEqual(rec.amount, { value: '93.25', currency: 'USD' });
    assert.equal(rec.created_at, '2026-11-07T10:00:00.000Z');
    assert.equal(rec.verdict, null);
  });

  it('gives a null amount when the dispute had none', () => {
    const rec = toCaseRecord({
      disputeId: 'x', captureId: null, paypalOrderId: null, mandateId: null, reason: null, stage: null, status: null,
      amountMinor: null, currency: null, verdict: null, analysisStatus: 'pending', actionTaken: null, outcome: null,
      createdAt: new Date(0), updatedAt: new Date(0),
    });
    assert.equal(rec.amount, null);
  });
});
