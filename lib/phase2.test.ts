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
