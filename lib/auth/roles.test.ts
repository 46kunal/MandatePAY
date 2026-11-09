/** Role and guard checks. Run: npx tsx --test lib/auth/roles.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authorize } from './guard';
import { can, isMerchantRole, PERMISSIONS, ROLES, type Permission } from './roles';

describe('roles', () => {
  it('a buyer can shop and see products, nothing on the merchant side', () => {
    assert.ok(can('buyer', 'shop'));
    assert.ok(can('buyer', 'products:read'));
    for (const p of ['cases:read', 'orders:read:all', 'products:write', 'settings:read', 'settings:write', 'cases:act'] as Permission[]) {
      assert.equal(can('buyer', p), false, p);
    }
  });

  it('staff work disputes, orders and products, but cannot approve actions or change settings', () => {
    for (const p of ['cases:read', 'cases:analyse', 'cases:act', 'disputes:poll', 'products:write', 'orders:read:all', 'settings:read'] as Permission[]) {
      assert.ok(can('staff', p), p);
    }
    assert.equal(can('staff', 'cases:approve'), false);
    assert.equal(can('staff', 'settings:write'), false);
    assert.equal(can('staff', 'users:manage'), false);
  });

  it('owners add approvals and settings; only admins manage users', () => {
    assert.ok(can('owner', 'cases:approve'));
    assert.ok(can('owner', 'settings:write'));
    assert.equal(can('owner', 'users:manage'), false);
    for (const p of PERMISSIONS) assert.ok(can('admin', p), p);
  });

  it('every role can shop for themselves; unknown or missing roles get nothing', () => {
    for (const r of ROLES) assert.ok(can(r, 'shop'), r);
    for (const r of [undefined, null, '', 'Admin', 'superuser', 42]) assert.equal(can(r, 'shop'), false, String(r));
  });

  it('merchant roles are staff, owner and admin', () => {
    assert.deepEqual(ROLES.filter(isMerchantRole), ['staff', 'owner', 'admin']);
  });
});

describe('authorize', () => {
  const user = (role: string) => ({ id: 'u1', email: 'a@b.test', name: 'A', role });

  it('401 when nobody is signed in', async () => {
    const r = authorize(null, 'shop');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.response.status, 401);
      assert.equal((await r.response.json()).error, 'unauthenticated');
    }
  });

  it('403 when the role lacks the permission, naming the permission', async () => {
    const r = authorize(user('buyer'), 'cases:read');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.response.status, 403);
      const body = await r.response.json();
      assert.equal(body.error, 'forbidden');
      assert.equal(body.details.permission, 'cases:read');
    }
  });

  it('passes the user through when allowed', () => {
    const r = authorize(user('owner'), 'settings:write');
    assert.ok(r.ok && r.user.id === 'u1');
  });
});
