/** Phase 2 checks: role-change rules, CSV safety, mandate status. Run: npx tsx --test lib/phase2.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MyMandate } from '../contracts/schemas';
import { can } from './auth/roles';
import { roleChangeProblem, type RoleChange } from './auth/team';
import { csvCell, toCsv } from './csv';
import { mandateStatus, toMyMandate } from './myData';

const change = (over: Partial<RoleChange>): RoleChange => ({
  actorId: 'owner-1',
  actorRole: 'owner',
  targetId: 'user-2',
  targetRole: 'buyer',
  newRole: 'staff',
  ownerCount: 1,
  ...over,
});

describe('roleChangeProblem', () => {
  it('an owner can make a buyer staff or owner, and remove staff', () => {
    assert.equal(roleChangeProblem(change({})), null);
    assert.equal(roleChangeProblem(change({ newRole: 'owner' })), null);
    assert.equal(roleChangeProblem(change({ targetRole: 'staff', newRole: 'buyer' })), null);
  });

  it('staff and buyers cannot change roles', () => {
    assert.match(roleChangeProblem(change({ actorRole: 'staff' }))!, /cannot change roles/);
    assert.match(roleChangeProblem(change({ actorRole: 'buyer' }))!, /cannot change roles/);
  });

  it('nobody changes their own role', () => {
    assert.match(roleChangeProblem(change({ targetId: 'owner-1', targetRole: 'owner', newRole: 'buyer' }))!, /your own role/);
  });

  it('only an admin gives or takes the admin role', () => {
    assert.match(roleChangeProblem(change({ newRole: 'admin' }))!, /Only an admin/);
    assert.match(roleChangeProblem(change({ targetRole: 'admin', newRole: 'staff' }))!, /Only an admin/);
    assert.equal(roleChangeProblem(change({ actorRole: 'admin', newRole: 'admin' })), null);
  });

  it('the last owner cannot be removed, even by an admin', () => {
    const lastOwner = change({ actorRole: 'admin', targetRole: 'owner', newRole: 'staff', ownerCount: 1 });
    assert.match(roleChangeProblem(lastOwner)!, /only owner/);
    assert.equal(roleChangeProblem({ ...lastOwner, ownerCount: 2 }), null);
  });

  it('rejects an unknown role', () => {
    assert.equal(roleChangeProblem(change({ newRole: 'superuser' })), 'Unknown role.');
  });

  it('new permissions sit with the right roles', () => {
    assert.ok(can('owner', 'team:manage') && can('owner', 'audit:read'));
    assert.ok(!can('staff', 'team:manage') && !can('staff', 'audit:read'));
    assert.ok(can('admin', 'system:read') && !can('owner', 'system:read'));
  });
});

describe('CSV', () => {
  it('quotes every cell and doubles quotes', () => {
    assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell(new Date('2026-11-10T00:00:00Z')), '"2026-11-10T00:00:00.000Z"');
  });

  it('defuses spreadsheet formulas in text a buyer could control', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+2', '-1', '@SUM(A1)']) {
      assert.ok(csvCell(evil).startsWith(`"'`), evil);
    }
    assert.equal(csvCell('14.00'), '"14.00"');
  });

  it('builds rows with CRLF line ends', () => {
    assert.equal(toCsv(['a', 'b'], [[1, 'x']]), '"a","b"\r\n"1","x"\r\n');
  });
});

describe('my mandates', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const row = {
    mandateId: 'mnd_1',
    requestText: 'socks under 20',
    constraints: { max_total: { value: '20.00', currency: 'USD' } },
    createdAt: new Date('2026-11-09T12:00:00Z'),
    expiresAt: new Date('2026-11-16T12:00:00Z'),
    revokedAt: null as Date | null,
  };

  it('status is active, expired or revoked (revoked wins)', () => {
    assert.equal(mandateStatus(row, now), 'active');
    assert.equal(mandateStatus({ ...row, expiresAt: new Date('2026-11-10T11:00:00Z') }, now), 'expired');
    assert.equal(mandateStatus({ ...row, revokedAt: now, expiresAt: new Date('2026-11-01T00:00:00Z') }, now), 'revoked');
  });

  it('maps to the contract shape', () => {
    const m = toMyMandate(row, 2, now);
    assert.ok(MyMandate.safeParse(m).success);
    assert.equal(m.orders, 2);
    assert.equal(m.revoked_at, null);
  });
});

describe('auto-analysis and deadlines', async () => {
  const { shouldAutoAnalyse } = await import('./analyst/runCase');
  const { responseDue } = await import('./paypal/disputes');
  const actionable = {
    dispute_id: 'PP-1',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    links: [{ rel: 'make_offer', href: 'x', method: 'POST' }],
    seller_response_due_date: '2026-11-29T18:20:26.029Z',
  };

  it('analyses a linked, never-analysed case once PayPal lets the seller act', () => {
    assert.equal(shouldAutoAnalyse({ analysisStatus: 'pending', mandateId: 'mnd_1', rawDispute: actionable }), true);
  });

  it('skips cases already analysed, not linked, or still under PayPal review', () => {
    assert.equal(shouldAutoAnalyse({ analysisStatus: 'analysed', mandateId: 'mnd_1', rawDispute: actionable }), false);
    assert.equal(shouldAutoAnalyse({ analysisStatus: 'pending', mandateId: null, rawDispute: actionable }), false);
    const underReview = { dispute_id: 'PP-1', status: 'UNDER_REVIEW', links: [{ rel: 'self', href: 'x', method: 'GET' }] };
    assert.equal(shouldAutoAnalyse({ analysisStatus: 'pending', mandateId: 'mnd_1', rawDispute: underReview }), false);
  });

  it('reads who PayPal is waiting on and until when', () => {
    assert.deepEqual(responseDue(actionable), { party: 'seller', at: '2026-11-29T18:20:26.029Z' });
    assert.deepEqual(responseDue({ buyer_response_due_date: '2026-11-29T11:02:03.675Z' }), { party: 'buyer', at: '2026-11-29T11:02:03.675Z' });
    assert.equal(responseDue({}), null);
    assert.equal(responseDue(null), null);
  });
});

describe('a no-action review keeps the case open', async () => {
  const { toCaseRecord } = await import('./paypal/cases');
  const { paypalStatusLabel } = await import('../app/_ui/labels');
  const row = (over: Record<string, unknown>) => ({
    disputeId: 'PP-1', captureId: null, paypalOrderId: null, mandateId: null, reason: 'X', stage: 'INQUIRY',
    status: 'WAITING_FOR_SELLER_RESPONSE', amountMinor: 8900, currency: 'USD', verdict: null, analysisStatus: 'acted',
    actionTaken: 'NO_ACTION', outcome: 'No action taken', createdAt: new Date('2026-11-10T00:00:00Z'), updatedAt: new Date('2026-11-10T00:00:00Z'),
    rawDispute: { dispute_id: 'PP-1', seller_response_due_date: '2026-11-30T11:56:57.557Z' },
    ...over,
  });

  it('older rows stored as acted with NO_ACTION are reported as still open, with the deadline', () => {
    const r = toCaseRecord(row({}));
    assert.equal(r.analysis_status, 'analysed');
    assert.deepEqual(r.response_due, { party: 'seller', at: '2026-11-30T11:56:57.557Z' });
  });

  it('a real response still closes the case on our side', () => {
    assert.equal(toCaseRecord(row({ actionTaken: 'SEND_MESSAGE' })).analysis_status, 'acted');
  });

  it('PayPal statuses read in the store’s words', () => {
    assert.equal(paypalStatusLabel('WAITING_FOR_SELLER_RESPONSE'), 'Waiting for the store');
    assert.equal(paypalStatusLabel('WAITING_FOR_BUYER_RESPONSE'), 'Waiting for the buyer');
    assert.equal(paypalStatusLabel('UNDER_REVIEW'), 'Under PayPal review');
    assert.equal(paypalStatusLabel('RESOLVED'), 'Resolved');
    assert.equal(paypalStatusLabel(null), 'Unknown');
  });
});
