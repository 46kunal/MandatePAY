/**
 * A7 unit checks. Run: npx tsx --test lib/paypal/caseActions.test.ts
 * In-memory store and a scripted PayPal: no Postgres, no network.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Verdict } from '../../contracts/schemas';
import { actOnCase, buildNote, type ActCase, type ActDeps, type ActInput } from './caseActions';
import type { CaseRow } from './cases';
import type { RawDispute } from './disputes';
import { PayPalError } from './errors';

const verdict = (over: Partial<Verdict> = {}): Verdict => ({
  fault: 'merchant',
  action: 'PROVIDE_EVIDENCE',
  confidence: 0.9,
  evidence_points: [{ claim: 'Buyer asked for white', source: 'mandates.constraints.required_attributes.color' }],
  reasoning: 'The cart matched the mandate.',
  needs_human: false,
  ...over,
});

const raw = (over: Partial<RawDispute> = {}): RawDispute => ({
  dispute_id: 'PP-D-1',
  dispute_amount: { currency_code: 'USD', value: '49.00' },
  links: [
    { rel: 'provide-evidence', href: 'x' },
    { rel: 'make-offer', href: 'x' },
    { rel: 'send-message', href: 'x' },
    { rel: 'accept-claim', href: 'x' },
  ],
  allowed_response_options: { make_offer: { offer_types: ['REFUND', 'REPLACEMENT_WITHOUT_REFUND'] } },
  ...over,
});

const baseRow = (over: Partial<CaseRow> = {}): CaseRow => ({
  disputeId: 'PP-D-1', captureId: 'CAP1', paypalOrderId: 'O1', mandateId: 'mnd_1', reason: 'R', stage: 'INQUIRY',
  status: 'WAITING_FOR_SELLER_RESPONSE', amountMinor: 4900, currency: 'USD', verdict: verdict(),
  analysisStatus: 'analysed', actionTaken: null, outcome: null,
  createdAt: new Date('2026-11-09T10:00:00Z'), updatedAt: new Date('2026-11-09T10:00:00Z'),
  ...over,
});

function setup(c: { row?: Partial<CaseRow>; rawDispute?: RawDispute | null } = {}, paypalError?: Error) {
  const calls: { fn: string; args: unknown[] }[] = [];
  let row: CaseRow | undefined = baseRow(c.row);
  const found: ActCase | undefined = row ? { row, rawDispute: c.rawDispute === undefined ? raw() : c.rawDispute } : undefined;
  const rec = (fn: string) => async (...args: unknown[]) => {
    if (paypalError) throw paypalError;
    calls.push({ fn, args });
  };
  const deps: ActDeps = {
    store: {
      getCase: async (id) => (found && id === found.row.disputeId ? found : undefined),
      markActed: async (_id, f) => {
        if (row!.analysisStatus === 'acted') return undefined;
        row = { ...row!, analysisStatus: 'acted', actionTaken: f.action, outcome: f.outcome, actedBy: f.actedBy ?? null, updatedAt: new Date('2026-11-09T11:00:00Z') };
        return row;
      },
    },
    actions: {
      provideEvidence: rec('provideEvidence') as ActDeps['actions']['provideEvidence'],
      makeOffer: rec('makeOffer') as ActDeps['actions']['makeOffer'],
      acceptClaim: rec('acceptClaim') as ActDeps['actions']['acceptClaim'],
      sendMessage: rec('sendMessage') as ActDeps['actions']['sendMessage'],
    },
  };
  return { deps, calls, getRow: () => row };
}

const approve: ActInput = { humanApproved: true };

describe('actOnCase: happy paths', () => {
  it('provides evidence from the verdict and marks the case acted', async () => {
    const s = setup();
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: false });
    assert.equal(r.ok, true);
    assert.deepEqual(s.calls.map((c) => c.fn), ['provideEvidence']);
    assert.match(String(s.calls[0].args[1]), /cart matched the mandate/);
    assert.match(String(s.calls[0].args[1]), /mandates\.constraints\.required_attributes\.color/);
    if (r.ok) {
      assert.equal(r.row.analysisStatus, 'acted');
      assert.equal(r.row.actionTaken, 'PROVIDE_EVIDENCE');
    }
  });

  it('attaches the evidence pack files to PROVIDE_EVIDENCE', async () => {
    const s = setup();
    const pdf = { filename: 'evidence-PP-D-1.pdf', contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) };
    const asked: string[] = [];
    s.deps.evidenceFiles = async (id) => (asked.push(id), [pdf]);
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: false });
    assert.equal(r.ok, true);
    assert.deepEqual(asked, ['PP-D-1']);
    assert.deepEqual(s.calls[0].args[2], [pdf]);
  });

  it('does not build the evidence pack for other actions', async () => {
    const s = setup({ row: { verdict: verdict({ action: 'MAKE_OFFER', offer_type: 'REFUND', offer_amount: '20.00' }) } });
    let built = false;
    s.deps.evidenceFiles = async () => ((built = true), []);
    await actOnCase(s.deps, 'PP-D-1', { humanApproved: false });
    assert.equal(built, false);
  });

  it('records who sent the action', async () => {
    const s = setup();
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: false, actedBy: 'usr_owner' });
    assert.ok(r.ok && r.row.actedBy === 'usr_owner');
  });

  it('makes an offer with the dispute currency', async () => {
    const s = setup({ row: { verdict: verdict({ action: 'MAKE_OFFER', offer_type: 'REFUND', offer_amount: '20.00' }) } });
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: false });
    assert.equal(r.ok, true);
    const offer = s.calls[0].args[1] as { offerType: string; amount: unknown };
    assert.equal(s.calls[0].fn, 'makeOffer');
    assert.equal(offer.offerType, 'REFUND');
    assert.deepEqual(offer.amount, { value: '20.00', currency: 'USD' });
  });

  it('accepts the claim and sends a message', async () => {
    const a = setup({ row: { verdict: verdict({ action: 'ACCEPT_CLAIM' }) } });
    assert.equal((await actOnCase(a.deps, 'PP-D-1', { humanApproved: false })).ok, true);
    assert.deepEqual(a.calls.map((c) => c.fn), ['acceptClaim']);

    const m = setup({ row: { verdict: verdict({ action: 'SEND_MESSAGE' }) } });
    assert.equal((await actOnCase(m.deps, 'PP-D-1', { humanApproved: false })).ok, true);
    assert.deepEqual(m.calls.map((c) => c.fn), ['sendMessage']);
  });

  it('NO_ACTION records the decision without calling PayPal', async () => {
    const s = setup({ row: { verdict: verdict({ action: 'NO_ACTION' }) } });
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: false });
    assert.equal(r.ok, true);
    assert.equal(s.calls.length, 0);
    assert.equal(s.getRow()!.analysisStatus, 'acted');
    assert.equal(s.getRow()!.actionTaken, 'NO_ACTION');
  });
});

describe('actOnCase: guards', () => {
  it('404 for an unknown case', async () => {
    const r = await actOnCase(setup().deps, 'nope', approve);
    assert.deepEqual([r.ok, !r.ok && r.httpStatus], [false, 404]);
  });

  it('409 when already acted, and PayPal is not called again', async () => {
    const s = setup({ row: { analysisStatus: 'acted', actionTaken: 'ACCEPT_CLAIM' } });
    const r = await actOnCase(s.deps, 'PP-D-1', approve);
    assert.deepEqual([r.ok, !r.ok && r.httpStatus], [false, 409]);
    assert.equal(s.calls.length, 0);
  });

  it('a second request after a success gets 409', async () => {
    const s = setup();
    assert.equal((await actOnCase(s.deps, 'PP-D-1', approve)).ok, true);
    // the stored case object is the same reference, so simulate the reload a real store would do
    const reload = setup({ row: { analysisStatus: 'acted' } });
    const again = await actOnCase(reload.deps, 'PP-D-1', approve);
    assert.equal(!again.ok && again.httpStatus, 409);
  });

  it('409 when a concurrent request wins the conditional update', async () => {
    const s = setup();
    s.deps.store.markActed = async () => undefined;
    const r = await actOnCase(s.deps, 'PP-D-1', approve);
    assert.equal(!r.ok && r.httpStatus, 409);
  });

  it('422 when there is no verdict and no override', async () => {
    const r = await actOnCase(setup({ row: { verdict: null } }).deps, 'PP-D-1', approve);
    assert.equal(!r.ok && r.httpStatus, 422);
  });

  it('422 when PayPal does not allow the action at this stage', async () => {
    const s = setup({ rawDispute: raw({ links: [{ rel: 'send-message', href: 'x' }], allowed_response_options: {} }) });
    const r = await actOnCase(s.deps, 'PP-D-1', approve);
    assert.equal(!r.ok && r.httpStatus, 422);
    assert.equal(!r.ok && r.error, 'action_not_allowed');
    assert.equal(s.calls.length, 0);
  });

  it('422 when there is no stored dispute (only NO_ACTION is possible)', async () => {
    const r = await actOnCase(setup({ rawDispute: null }).deps, 'PP-D-1', approve);
    assert.equal(!r.ok && r.httpStatus, 422);
  });

  it('403 when the verdict needs a human and human_approved is false', async () => {
    const s = setup({ row: { verdict: verdict({ needs_human: true }) } });
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: false });
    assert.equal(!r.ok && r.httpStatus, 403);
    assert.equal(s.calls.length, 0);
    assert.equal(s.getRow()!.analysisStatus, 'analysed');
  });

  it('runs when needs_human is true and the human approved', async () => {
    const s = setup({ row: { verdict: verdict({ needs_human: true }) } });
    assert.equal((await actOnCase(s.deps, 'PP-D-1', approve)).ok, true);
  });

  it('an override always needs human approval', async () => {
    const s = setup();
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: false, override: { action: 'ACCEPT_CLAIM' } });
    assert.equal(!r.ok && r.httpStatus, 403);
    assert.equal(s.calls.length, 0);
  });

  it('the override replaces the verdict action once approved', async () => {
    const s = setup();
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: true, override: { action: 'ACCEPT_CLAIM' } });
    assert.equal(r.ok, true);
    assert.deepEqual(s.calls.map((c) => c.fn), ['acceptClaim']);
  });

  it('the override action is checked against allowed actions too', async () => {
    const s = setup({ rawDispute: raw({ links: [{ rel: 'provide-evidence', href: 'x' }], allowed_response_options: {} }) });
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: true, override: { action: 'ACCEPT_CLAIM' } });
    assert.equal(!r.ok && r.httpStatus, 422);
  });
});

describe('actOnCase: offers', () => {
  const offerRow = (v: Partial<Verdict>) => ({ verdict: verdict({ action: 'MAKE_OFFER', ...v }) });

  it('422 when the offer type is not in the dispute offer_types', async () => {
    const s = setup({ row: offerRow({ offer_type: 'REFUND_WITH_RETURN', offer_amount: '10.00' }) });
    const r = await actOnCase(s.deps, 'PP-D-1', approve);
    assert.equal(!r.ok && r.httpStatus, 422);
    assert.equal(!r.ok && r.error, 'offer_type_not_allowed');
    assert.equal(s.calls.length, 0);
  });

  it('422 when the offer is incomplete', async () => {
    const r = await actOnCase(setup({ row: offerRow({ offer_type: 'REFUND' }) }).deps, 'PP-D-1', approve);
    assert.equal(!r.ok && r.error, 'offer_incomplete');
  });

  it('422 when the amount is zero or above the disputed amount', async () => {
    for (const amount of ['0.00', '49.01']) {
      const r = await actOnCase(setup({ row: offerRow({ offer_type: 'REFUND', offer_amount: amount }) }).deps, 'PP-D-1', approve);
      assert.equal(!r.ok && r.error, 'offer_amount_invalid');
    }
  });

  it('an override offer uses its own fields, not the verdict ones', async () => {
    const s = setup({ row: offerRow({ offer_type: 'REFUND', offer_amount: '49.00' }) });
    const r = await actOnCase(s.deps, 'PP-D-1', {
      humanApproved: true,
      override: { action: 'MAKE_OFFER', offer_type: 'REPLACEMENT_WITHOUT_REFUND', offer_amount: '5.00' },
    });
    assert.equal(r.ok, true);
    const offer = s.calls[0].args[1] as { offerType: string; amount: { value: string } };
    assert.equal(offer.offerType, 'REPLACEMENT_WITHOUT_REFUND');
    assert.equal(offer.amount.value, '5.00');
  });

  it('an override that switches to an offer does not inherit verdict offer fields', async () => {
    const s = setup({ row: { verdict: verdict({ action: 'ACCEPT_CLAIM', offer_type: 'REFUND', offer_amount: '10.00' }) } });
    const r = await actOnCase(s.deps, 'PP-D-1', { humanApproved: true, override: { action: 'MAKE_OFFER' } });
    assert.equal(!r.ok && r.error, 'offer_incomplete');
  });
});

describe('actOnCase: PayPal failures', () => {
  it('maps PayPalError to 502 and leaves the case unacted', async () => {
    const err = new PayPalError('PayPal POST failed (UNPROCESSABLE_ENTITY)', {
      status: 422, paypalName: 'UNPROCESSABLE_ENTITY', debugId: 'dbg123',
    });
    const s = setup({}, err);
    const r = await actOnCase(s.deps, 'PP-D-1', approve);
    assert.equal(!r.ok && r.httpStatus, 502);
    assert.equal(!r.ok && r.error, 'paypal_error');
    assert.deepEqual(!r.ok && r.details, { debugId: 'dbg123', paypalName: 'UNPROCESSABLE_ENTITY' });
    assert.equal(s.getRow()!.analysisStatus, 'analysed');
  });

  it('rethrows non-PayPal errors', async () => {
    await assert.rejects(actOnCase(setup({}, new TypeError('boom')).deps, 'PP-D-1', approve), /boom/);
  });
});

describe('buildNote', () => {
  it('falls back without a verdict and caps the length', () => {
    assert.equal(buildNote(null, 'fallback'), 'fallback');
    assert.equal(buildNote(verdict({ reasoning: 'x'.repeat(5000) }), 'f').length, 2000);
  });
});
