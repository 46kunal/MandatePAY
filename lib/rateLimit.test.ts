/** Run: npx tsx --test lib/rateLimit.test.ts */
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { allow, limited, resetLimits } from './rateLimit';

describe('rate limit', () => {
  beforeEach(resetLimits);
  it('allows up to max per window, then refuses', () => {
    for (let i = 0; i < 3; i++) assert.ok(allow('k', 3, 1000, 100 + i));
    assert.ok(!allow('k', 3, 1000, 200));
  });
  it('frees up when the window passes, and keys are separate', () => {
    for (let i = 0; i < 3; i++) allow('k', 3, 1000, 100);
    assert.ok(!allow('k', 3, 1000, 500));
    assert.ok(allow('k', 3, 1000, 1200));
    assert.ok(allow('other', 3, 1000, 500));
  });
  it('limited() answers 429 with retry-after', async () => {
    for (let i = 0; i < 2; i++) assert.equal(limited('u', 'ai', 2), null);
    const res = limited('u', 'ai', 2);
    assert.equal(res?.status, 429);
    assert.equal(res?.headers.get('retry-after'), '60');
  });
});
