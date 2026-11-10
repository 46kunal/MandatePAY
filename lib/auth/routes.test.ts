/** Where each role may go. Run: npx tsx --test lib/auth/routes.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canOpen, homeFor, landingFor } from './routes';

describe('role areas', () => {
  it('a buyer opens only the buyer area', () => {
    assert.ok(canOpen('buyer', 'buyer'));
    assert.ok(!canOpen('buyer', 'merchant') && !canOpen('buyer', 'admin'));
  });
  it('staff open only the store area', () => {
    assert.ok(canOpen('staff', 'merchant'));
    assert.ok(!canOpen('staff', 'buyer') && !canOpen('staff', 'admin'));
  });
  it('owners open the buyer and store areas, admins open everything', () => {
    assert.ok(canOpen('owner', 'buyer') && canOpen('owner', 'merchant') && !canOpen('owner', 'admin'));
    assert.ok(canOpen('admin', 'buyer') && canOpen('admin', 'merchant') && canOpen('admin', 'admin'));
  });
  it('unknown or missing roles open nothing', () => {
    for (const r of [undefined, null, '', 'guest', 'root']) {
      assert.ok(!canOpen(r, 'buyer') && !canOpen(r, 'merchant') && !canOpen(r, 'admin'));
    }
  });
});

describe('where to land after signing in', () => {
  it('each role goes home', () => {
    assert.equal(homeFor('buyer'), '/buyer');
    assert.equal(homeFor('staff'), '/merchant');
    assert.equal(homeFor('owner'), '/merchant');
    assert.equal(homeFor('admin'), '/merchant');
  });
  it('the page they asked for is kept only if their role may open it', () => {
    assert.equal(landingFor('buyer', '/buyer/account'), '/buyer/account');
    assert.equal(landingFor('buyer', '/merchant/orders'), '/buyer');
    assert.equal(landingFor('buyer', '/admin'), '/buyer');
    assert.equal(landingFor('staff', '/buyer'), '/merchant');
    assert.equal(landingFor('owner', '/buyer'), '/buyer');
    assert.equal(landingFor('owner', '/admin'), '/merchant');
    assert.equal(landingFor('admin', '/admin'), '/admin');
  });
  it('never sends anyone off-site', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)']) {
      assert.equal(landingFor('buyer', bad), '/buyer', bad);
    }
    assert.equal(landingFor('buyer', null), '/buyer');
  });
});
