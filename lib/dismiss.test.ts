/** Dismissed disputes. Run: npx tsx --test lib/dismiss.test.ts (no database) */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CaseRecord } from '../contracts/schemas';
import { toCaseRecord, type CaseRow } from './paypal/cases';

const row = (over: Partial<CaseRow> = {}): CaseRow => ({
  disputeId: 'PP-R-1',
  captureId: null,
  paypalOrderId: null,
  mandateId: null,
  reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  stage: 'INQUIRY',
  status: 'WAITING_FOR_BUYER_RESPONSE',
  amountMinor: 8900,
  currency: 'USD',
  verdict: null,
  analysisStatus: 'pending',
  actionTaken: null,
  outcome: null,
  createdAt: new Date('2026-11-10T10:00:00Z'),
  updatedAt: new Date('2026-11-10T10:00:00Z'),
  ...over,
});

describe('dismissed disputes', () => {
  it('a shown dispute has no dismissed_at', () => {
    const r = toCaseRecord(row());
    assert.equal(r.dismissed_at, null);
    assert.ok(CaseRecord.safeParse(r).success);
  });

  it('a dismissed dispute carries when it was hidden', () => {
    const r = toCaseRecord(row({ dismissedAt: new Date('2026-11-11T08:30:00Z') }));
    assert.equal(r.dismissed_at, '2026-11-11T08:30:00.000Z');
    assert.ok(CaseRecord.safeParse(r).success);
  });
});
