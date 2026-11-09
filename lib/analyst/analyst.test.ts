/** B9 checks, using fixtures (no database, mock LLM). Run: npx tsx --test lib/analyst/analyst.test.ts */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Verdict, type DisputeSummary } from '../../contracts/schemas';
import { analyseCase, enforce, resolvePath, type AnalystInput } from './analyst';

function input(dispute: Partial<DisputeSummary> = {}): AnalystInput {
  return {
    dispute: {
      dispute_id: 'PP-D-1',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
      stage: 'INQUIRY',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amount: { value: '89.99', currency: 'USD' },
      allowed_actions: ['PROVIDE_EVIDENCE', 'MAKE_OFFER', 'ACCEPT_CLAIM', 'SEND_MESSAGE', 'NO_ACTION'],
      offer_types: ['REFUND', 'REFUND_WITH_RETURN'],
      messages: [],
      ...dispute,
    },
    mandate: {
      mandate_id: 'mnd_1',
      constraints: {
        max_total: { value: '110.00', currency: 'USD' },
        required_attributes: { color: 'white', size: '10' },
        request_text: 'white trainers size 10 under 110',
      },
    },
    cart: {
      currency: 'USD',
      items: [{ sku: 's1', name: 'White trainers', quantity: 1, unit_price: '89.99', attributes: { color: 'white', size: '10' } }],
    },
  };
}

const proposal = (over: Partial<Verdict> = {}): Verdict => ({
  fault: 'merchant',
  action: 'MAKE_OFFER',
  offer_type: 'REFUND',
  offer_amount: '50.00',
  confidence: 0.9,
  evidence_points: [{ claim: 'Reason is not-as-described.', source: 'dispute.reason' }],
  reasoning: 'Because.',
  needs_human: false,
  ...over,
});

describe('guardrails (enforce)', () => {
  it('leaves a sound, low-value proposal alone', () => {
    const out = enforce(proposal(), input({ amount: { value: '50.00', currency: 'USD' } }));
    assert.equal(out.action, 'MAKE_OFFER');
    assert.equal(out.needs_human, false);
  });

  it('replaces an action PayPal does not allow with NO_ACTION and forces a human', () => {
    const out = enforce(proposal({ action: 'ACCEPT_CLAIM' }), input({ allowed_actions: ['SEND_MESSAGE', 'NO_ACTION'] }));
    assert.equal(out.action, 'NO_ACTION');
    assert.equal(out.offer_type, undefined);
    assert.ok(out.needs_human);
    assert.match(out.reasoning, /not allowed/);
  });

  it('removes a disallowed offer type', () => {
    const out = enforce(proposal({ offer_type: 'REPLACEMENT_WITHOUT_REFUND' }), input());
    assert.equal(out.action, 'NO_ACTION');
    assert.ok(out.needs_human);
  });

  it('caps an offer above the disputed amount', () => {
    const out = enforce(proposal({ offer_amount: '500.00' }), input());
    assert.equal(out.offer_amount, '89.99');
    assert.ok(out.needs_human);
  });

  it('drops evidence that cites a field that does not exist, and needs a human if none is left', () => {
    const out = enforce(proposal({ evidence_points: [{ claim: 'Made up.', source: 'cart.items[5].color' }] }), input());
    assert.equal(out.evidence_points.length, 0);
    assert.ok(out.needs_human);
  });

  it('forces a human for low confidence, unclear fault, or high value, and never lowers needs_human', () => {
    const small = input({ amount: { value: '20.00', currency: 'USD' } });
    assert.ok(enforce(proposal({ confidence: 0.5 }), small).needs_human);
    assert.ok(enforce(proposal({ fault: 'unclear' }), small).needs_human);
    assert.ok(enforce(proposal(), input({ amount: { value: '100.00', currency: 'USD' } })).needs_human);
    assert.ok(enforce(proposal({ needs_human: true }), small).needs_human);
  });

  it('resolves evidence paths', () => {
    const i = input();
    assert.equal(resolvePath(i, 'cart.items[0].attributes.color'), 'white');
    assert.equal(resolvePath(i, 'cart.items[1]'), undefined);
    assert.equal(resolvePath(i, 'nonsense.path'), undefined);
  });
});

describe('analyseCase with the mock LLM', () => {
  it('within the mandate but wrong product: blames the agent, offers a refund with return, asks a human', async () => {
    const v = await analyseCase(input());
    assert.ok(Verdict.safeParse(v).success);
    assert.equal(v.fault, 'agent');
    assert.equal(v.action, 'MAKE_OFFER');
    assert.equal(v.offer_type, 'REFUND_WITH_RETURN');
    assert.equal(v.offer_amount, '89.99');
    assert.equal(v.needs_human, false); // 89.99 is under the 100.00 review limit and 0.72 is above the 0.7 floor
    assert.ok((await analyseCase(input({ amount: { value: '150.00', currency: 'USD' } }))).needs_human);
  });

  it('item never arrived: blames the merchant and refunds', async () => {
    const v = await analyseCase(input({ reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', tracking: { status: 'IN_TRANSIT' } }), { humanReviewOver: '500.00' });
    assert.equal(v.fault, 'merchant');
    assert.equal(v.action, 'MAKE_OFFER');
    assert.equal(v.needs_human, false);
  });

  it('delivered per tracking: buyer regret, merchant provides evidence', async () => {
    const v = await analyseCase(input({ reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', tracking: { status: 'DELIVERED' } }), { humanReviewOver: '500.00' });
    assert.equal(v.fault, 'buyer_regret');
    assert.equal(v.action, 'PROVIDE_EVIDENCE');
  });

  it('only ever picks an allowed action', async () => {
    const v = await analyseCase(input({ allowed_actions: ['NO_ACTION'], offer_types: [] }));
    assert.equal(v.action, 'NO_ACTION');
  });

  it('unknown dispute reason goes to a human', async () => {
    const v = await analyseCase(input({ reason: 'SOMETHING_NEW' }), { humanReviewOver: '500.00' });
    assert.equal(v.fault, 'unclear');
    assert.ok(v.needs_human);
  });
});
