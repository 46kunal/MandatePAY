/** B9 checks. Run: npx tsx --test lib/analyst/analyst.test.ts. A scripted provider stands in for the model; no network. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Verdict, type DisputeSummary } from '../../contracts/schemas';
import type { LlmProvider, ProviderCall } from '../ai';
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
  it('provide-evidence not offered at this stage becomes a message that carries the evidence', () => {
    const i = input({ allowed_actions: ['ACCEPT_CLAIM', 'MAKE_OFFER', 'SEND_MESSAGE', 'NO_ACTION'], amount: { value: '50.00', currency: 'USD' } });
    const out = enforce(proposal({ fault: 'buyer_regret', action: 'PROVIDE_EVIDENCE', offer_type: undefined, confidence: 0.95 }), i);
    assert.equal(out.action, 'SEND_MESSAGE');
    assert.equal(out.needs_human, false); // the same intent, just a different channel
    assert.match(out.reasoning, /sent in a message instead/);
  });

  it('with neither evidence nor message offered, it falls back to no action and a person', () => {
    const i = input({ allowed_actions: ['ACCEPT_CLAIM', 'NO_ACTION'], amount: { value: '50.00', currency: 'USD' } });
    const out = enforce(proposal({ fault: 'buyer_regret', action: 'PROVIDE_EVIDENCE', offer_type: undefined, confidence: 0.95 }), i);
    assert.equal(out.action, 'NO_ACTION');
    assert.equal(out.needs_human, true);
  });

  it('a payment by a different PayPal payer than the buyer linked always needs a person', () => {
    const i = { ...input({ amount: { value: '50.00', currency: 'USD' } }), payment: { source: 'paypal', payer_check: 'different' as const, mandate_signed_with: 'buyer_key' as const } };
    const out = enforce(proposal({ fault: 'buyer_regret', action: 'MAKE_OFFER', confidence: 0.95 }), i);
    assert.equal(out.needs_human, true);
    assert.match(out.reasoning, /different PayPal payer/);
  });

  it('a matching payer adds no flag, and payment facts can be cited as evidence', () => {
    const i = { ...input({ amount: { value: '50.00', currency: 'USD' } }), payment: { source: 'paypal', payer_check: 'match' as const, mandate_signed_with: 'buyer_key' as const } };
    const out = enforce(
      proposal({
        confidence: 0.95,
        evidence_points: [
          { claim: 'The buyer’s own PayPal account paid.', source: 'payment.payer_check' },
          { claim: 'The buyer signed the mandate with their own key.', source: 'payment.mandate_signed_with' },
        ],
      }),
      i,
    );
    assert.equal(out.evidence_points.length, 2);
    assert.doesNotMatch(out.reasoning, /different PayPal payer/);
  });

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

/** Stands in for the model: returns the given proposal and records what it was asked. */
function modelSays(v: Verdict): LlmProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];
  return { name: 'scripted', deterministic: false, calls, complete: async (c) => (calls.push(c), v) };
}

describe('analyseCase: the model proposes, the guardrails decide', () => {
  it('passes the dispute, mandate and cart to the model and returns a valid verdict', async () => {
    const m = modelSays(proposal({ offer_amount: '89.99' }));
    const v = await analyseCase(input(), { provider: m, humanReviewOver: '500.00' });
    assert.ok(Verdict.safeParse(v).success);
    const sent = JSON.parse(m.calls[0].user) as AnalystInput;
    assert.equal(sent.dispute.dispute_id, 'PP-D-1');
    assert.equal(sent.mandate.mandate_id, 'mnd_1');
    assert.equal(sent.cart.items[0].sku, 's1');
    assert.equal(v.needs_human, false);
  });

  it('a high-value dispute always needs a human, whatever the model said', async () => {
    const v = await analyseCase(input({ amount: { value: '150.00', currency: 'USD' } }), { provider: modelSays(proposal()) });
    assert.ok(v.needs_human);
  });

  it('an action PayPal does not allow becomes NO_ACTION', async () => {
    const v = await analyseCase(input({ allowed_actions: ['NO_ACTION'], offer_types: [] }), { provider: modelSays(proposal()) });
    assert.equal(v.action, 'NO_ACTION');
    assert.ok(v.needs_human);
  });

  it('an unclear verdict goes to a human', async () => {
    const v = await analyseCase(input(), { provider: modelSays(proposal({ fault: 'unclear', action: 'SEND_MESSAGE', offer_type: undefined, offer_amount: undefined })), humanReviewOver: '500.00' });
    assert.ok(v.needs_human);
  });

  it('a model answer that is not a Verdict is rejected', async () => {
    const broken: LlmProvider = { name: 'scripted', deterministic: false, complete: async () => ({ fault: 'nobody' }) };
    await assert.rejects(analyseCase(input(), { provider: broken }));
  });
});
