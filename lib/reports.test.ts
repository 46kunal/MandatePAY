/** Buyer problem reports and the results page. Run: npx tsx --test lib/reports.test.ts (no database, no network). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GuardResult } from '../contracts/schemas';
import { CreateReportRequest, ResolveReportRequest, ResultsResponse } from '../contracts/schemas';
import { assessReport, toProblemReport } from './reports/assess';
import { computeResults, MANUAL_MINUTES_PER_DISPUTE } from './results';

const guard = (checks: GuardResult['checks'], verdict: GuardResult['verdict'] = 'allow'): GuardResult => ({ verdict, checks, total: '89.00', currency: 'USD' });
const pass = { rule: 'max_total', status: 'pass' as const, detail: '89.00 within 110.00' };
const unsure = { rule: 'required_attributes', status: 'unsure' as const, detail: 'size 9 asked, listing says 9.5' };

describe('assessing a report from the records', () => {
  it('agent mistake when the guard had doubts at checkout: refund recommended', () => {
    const a = assessReport('agent_mistake', guard([pass, unsure], 'escalate'));
    assert.equal(a.agent_mistake, true);
    assert.equal(a.suggestion, 'refund');
    assert.deepEqual(a.checks, [unsure]);
    assert.match(a.summary, /Size and attributes: size 9 asked/);
  });

  it('every check passed: not an agent mistake, the store reviews it', () => {
    const a = assessReport('agent_mistake', guard([pass]));
    assert.equal(a.agent_mistake, false);
    assert.equal(a.suggestion, 'review');
    assert.deepEqual(a.checks, []);
  });

  it('not received or damaged is for a person, unless the guard also had doubts', () => {
    assert.equal(assessReport('not_received', guard([pass])).suggestion, 'review');
    assert.equal(assessReport('damaged', guard([pass])).agent_mistake, false);
    const both = assessReport('other', guard([unsure], 'escalate'));
    assert.equal(both.agent_mistake, true);
    assert.equal(both.suggestion, 'refund');
  });

  it('no checkout check on record: review by hand', () => {
    assert.deepEqual(assessReport('agent_mistake', null).suggestion, 'review');
  });

  it('maps a stored row for the API', () => {
    const r = toProblemReport(
      {
        reportId: 'rpt_1',
        paypalOrderId: 'O1',
        kind: 'agent_mistake',
        message: 'Wrong size',
        assessment: assessReport('agent_mistake', guard([unsure])),
        status: 'refunded',
        reply: 'Sorry',
        refundMinor: 8900,
        createdAt: new Date('2026-11-10T10:00:00Z'),
        resolvedAt: new Date('2026-11-10T11:00:00Z'),
      },
      'USD',
    );
    assert.deepEqual(r.refund, { value: '89.00', currency: 'USD' });
    assert.equal(r.resolved_at, '2026-11-10T11:00:00.000Z');
  });

  it('validates requests', () => {
    assert.ok(CreateReportRequest.safeParse({ kind: 'not_received', message: 'Never came' }).success);
    assert.ok(!CreateReportRequest.safeParse({ kind: 'not_received', message: 'no' }).success);
    assert.ok(!CreateReportRequest.safeParse({ kind: 'refund_me', message: 'Never came' }).success);
    assert.ok(ResolveReportRequest.safeParse({ outcome: 'refund', reply: 'Refunded', idempotency_key: 'abcd-1234' }).success);
    assert.ok(!ResolveReportRequest.safeParse({ outcome: 'refund', reply: 'Refunded' }).success);
  });
});

describe('results', () => {
  const t = (iso: string) => new Date(iso);
  const out = computeResults({
    now: t('2026-11-10T12:00:00Z'),
    cases: [
      { disputeId: 'A', analysed: true, outcome: 'RESOLVED_BUYER_FAVOUR (refunded 14.00 USD)', status: 'RESOLVED', createdAt: t('2026-11-10T10:00:00Z') },
      { disputeId: 'B', analysed: true, outcome: null, status: 'WAITING_FOR_BUYER_RESPONSE', createdAt: t('2026-11-10T10:00:00Z') },
      { disputeId: 'C', analysed: false, outcome: null, status: 'WAITING_FOR_SELLER_RESPONSE', createdAt: t('2026-11-10T11:00:00Z') },
    ],
    acts: [
      { disputeId: 'A', at: t('2026-11-10T10:10:00Z'), action: 'ACCEPT_CLAIM', override: false, humanApproved: true },
      { disputeId: 'B', at: t('2026-11-10T10:30:00Z'), action: 'SEND_MESSAGE', override: true, humanApproved: false },
      { disputeId: 'B', at: t('2026-11-10T10:05:00Z'), action: 'NO_ACTION', override: false, humanApproved: false },
    ],
    carts: [
      { verdict: 'allow', totalMinor: 8900, currency: 'USD' },
      { verdict: 'block', totalMinor: 25000, currency: 'USD' },
      { verdict: 'escalate', totalMinor: 4000, currency: 'USD' },
    ],
    ordersPaid: 2,
    refunds: [
      { amountMinor: 1400, currency: 'USD', status: 'COMPLETED' },
      { amountMinor: 8540, currency: 'USD', status: 'PENDING' },
      { amountMinor: 999, currency: 'USD', status: 'FAILED' },
    ],
    reports: [
      { status: 'refunded', agentMistake: true },
      { status: 'open', agentMistake: false },
    ],
    evalResults: { run_at: '2026-11-10T00:00:00Z', provider: 'gemini', cases: 28, fault: 0.821, action: 0.857, needs_human: 0.889, overall: 0.786 },
  });

  it('matches the contract', () => {
    assert.ok(ResultsResponse.safeParse(out).success);
  });

  it('counts disputes and outcomes', () => {
    assert.deepEqual(out.disputes, { total: 3, analysed: 2, responded: 2, resolved: 1, store_won: 0, buyer_won: 1 });
  });

  it('no action is not a response; an override is a person choosing differently', () => {
    assert.deepEqual(out.people, { responses: 2, followed_ai: 1, changed_ai: 1, approved_by_person: 1 });
  });

  it('time to response uses the first real response; time saved is an estimate per analysed dispute', () => {
    assert.equal(out.speed.median_minutes_to_response, 20); // 10 and 30 minutes
    assert.equal(out.speed.est_minutes_saved, 2 * MANUAL_MINUTES_PER_DISPUTE);
  });

  it('the guard and refunds', () => {
    assert.deepEqual(out.guard, { carts_checked: 3, allowed: 1, needed_approval: 1, blocked: 1, blocked_value: { value: '250.00', currency: 'USD' }, orders_paid: 2 });
    assert.deepEqual(out.refunds, { count: 2, total: { value: '99.40', currency: 'USD' } });
    assert.deepEqual(out.reports, { total: 2, open: 1, refunded: 1, closed: 0, agent_mistakes: 1 });
  });

  it('nothing yet: no division by zero, no made-up numbers', () => {
    const empty = computeResults({ cases: [], acts: [], carts: [], ordersPaid: 0, refunds: [], reports: [], evalResults: null });
    assert.equal(empty.speed.median_minutes_to_response, null);
    assert.equal(empty.guard.blocked_value, null);
    assert.equal(empty.refunds.total, null);
    assert.ok(ResultsResponse.safeParse(empty).success);
  });
});
