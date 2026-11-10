/** Store settings checks. Run: npx tsx --test lib/settings.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StoreSettings, UpdateStoreSettingsRequest } from '../contracts/schemas';
import { patchToColumns, resolveSettings, type SettingsRow } from './settings';

const env = { MERCHANT_NAME: 'Env Shop', APPROVAL_THRESHOLD: '100.00' };
const row = (over: Partial<SettingsRow> = {}): SettingsRow => ({
  storeName: null,
  supportEmail: null,
  approvalThresholdMinor: null,
  humanReviewOverMinor: null,
  minConfidence: null,
  updatedAt: new Date('2026-11-10T09:00:00Z'),
  ...over,
});

describe('resolveSettings', () => {
  it('with nothing saved, behaves exactly like the environment did', () => {
    const s = resolveSettings(undefined, env);
    assert.ok(StoreSettings.safeParse(s).success);
    assert.deepEqual(s, {
      store_name: 'Env Shop',
      support_email: null,
      approval_threshold: '100.00',
      human_review_over: '100.00',
      min_confidence: 0.7,
      auto_analyse: true,
      updated_at: null,
    });
  });

  it('saved values win; null columns still fall back', () => {
    const s = resolveSettings(row({ storeName: 'Sole Trader', approvalThresholdMinor: 7550, minConfidence: 0.8 }), env);
    assert.equal(s.store_name, 'Sole Trader');
    assert.equal(s.approval_threshold, '75.50');
    assert.equal(s.human_review_over, '100.00');
    assert.equal(s.min_confidence, 0.8);
    assert.equal(s.updated_at, '2026-11-10T09:00:00.000Z');
  });
});

describe('patchToColumns', () => {
  it('writes only the keys sent, converts money to minor units and trims text', () => {
    assert.deepEqual(patchToColumns({ approval_threshold: '120.00', store_name: '  Sole Trader ' }), {
      approvalThresholdMinor: 12000,
      storeName: 'Sole Trader',
    });
  });

  it('null clears a text field', () => {
    assert.deepEqual(patchToColumns({ support_email: null }), { supportEmail: null });
  });
});

describe('UpdateStoreSettingsRequest', () => {
  it('rejects bad money, out-of-range confidence, bad email and unknown keys', () => {
    for (const bad of [{ approval_threshold: '100' }, { min_confidence: 1.5 }, { support_email: 'nope' }, { paypal_secret: 'x' }]) {
      assert.equal(UpdateStoreSettingsRequest.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });
});
