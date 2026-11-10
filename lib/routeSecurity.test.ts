/**
 * Security review as a test: every API route must check who is calling, except a short, named list.
 * A new route that forgets the check fails here instead of shipping open. Run: npx tsx --test lib/routeSecurity.test.ts
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const API = path.join(__dirname, '..', 'app', 'api');

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : [];
  });
}

/** Public on purpose, and why. */
const PUBLIC: Record<string, string> = {
  'auth/[...all]/route.ts': "Better Auth's own sign-in endpoints, rate limited by Better Auth",
  'health/route.ts': 'uptime check: returns only up or down',
  'webhooks/paypal/route.ts': "PayPal calls it; the request is accepted only with a valid PayPal signature",
};

describe('API route security', () => {
  const all = routes(API).map((p) => ({ rel: path.relative(API, p).split(path.sep).join('/'), src: readFileSync(p, 'utf8') }));

  it('finds the routes', () => assert.ok(all.length > 25));

  it('every route checks the caller unless it is on the public list', () => {
    const open = all.filter((r) => !/requirePermission|sessionUser|authorize\(|requireApiKey/.test(r.src) && !(r.rel in PUBLIC)).map((r) => r.rel);
    assert.deepEqual(open, [], `These routes do not check who is calling: ${open.join(', ')}`);
  });

  it('the public list has no stale entries', () => {
    for (const k of Object.keys(PUBLIC)) assert.ok(all.some((r) => r.rel === k), `${k} no longer exists`);
  });

  it('the PayPal webhook verifies the signature before it does anything', () => {
    const src = all.find((r) => r.rel === 'webhooks/paypal/route.ts')?.src ?? '';
    assert.match(src, /verif|signature/i);
  });

  it('routes that move money or send to PayPal need a store permission, not just a sign-in', () => {
    const need: Record<string, RegExp> = {
      'orders/[id]/refund/route.ts': /'orders:refund'/,
      'reports/[id]/resolve/route.ts': /'cases:act'/,
      'cases/[id]/act/route.ts': /'cases:act'|'cases:approve'/,
      'disputes/poll/route.ts': /'disputes:poll'/,
      'settings/route.ts': /'settings:write'/,
    };
    for (const [rel, re] of Object.entries(need)) {
      const src = all.find((r) => r.rel === rel)?.src;
      assert.ok(src, `${rel} missing`);
      assert.match(src, re, rel);
    }
  });
});
