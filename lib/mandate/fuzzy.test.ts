/** B7 checks. Run: npx tsx --test lib/mandate/fuzzy.test.ts. A scripted provider stands in for the model; no network. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cart, Constraints } from '../../contracts/schemas';
import type { LlmProvider } from '../ai';
import { evaluateCart } from './guard';
import { resolveUnsure } from './fuzzy';

const constraints: Constraints = {
  max_total: { value: '110.00', currency: 'USD' },
  categories: ['shoes'],
  required_attributes: { color: 'white' },
  request_text: 'white shoes under 110',
};

const cart = (name: string, extra: Partial<Cart['items'][number]> = {}): Cart => ({
  currency: 'USD',
  items: [{ sku: 's', name, quantity: 1, unit_price: '80.00', ...extra }],
});

type Decision = 'match' | 'no_match' | 'unsure';
function model(decisions: Record<string, [Decision, number]>): LlmProvider & { calls: number } {
  const p = {
    name: 'scripted',
    deterministic: false,
    calls: 0,
    async complete() {
      p.calls++;
      return { results: Object.entries(decisions).map(([rule, [decision, confidence]]) => ({ rule, decision, confidence, reason: 'scripted' })) };
    },
  };
  return p;
}
const status = (g: Awaited<ReturnType<typeof resolveUnsure>>, rule: string) => g.checks.find((x) => x.rule === rule)?.status;

describe('fuzzy matching (B7)', () => {
  it('a confident match settles unsure checks and is labelled as an AI judgement', async () => {
    const c = cart('White leather shoes');
    const before = evaluateCart(constraints, c);
    assert.equal(before.verdict, 'escalate');
    const g = await resolveUnsure(before, constraints, c, { provider: model({ categories: ['match', 0.95], required_attributes: ['match', 0.9] }) });
    assert.equal(status(g, 'categories'), 'pass');
    assert.equal(status(g, 'required_attributes'), 'pass');
    assert.equal(g.verdict, 'allow');
    assert.match(g.checks.find((x) => x.rule === 'categories')!.detail, /AI judgement/);
  });

  it('a low-confidence match leaves the check unsure, so the buyer decides', async () => {
    const c = cart('Mystery footwear');
    const g = await resolveUnsure(evaluateCart(constraints, c), constraints, c, { provider: model({ categories: ['match', 0.4] }) });
    assert.equal(status(g, 'categories'), 'unsure');
    assert.equal(g.verdict, 'escalate');
  });

  it('a no_match turns the check into a fail', async () => {
    const c = cart('Black boots');
    const g = await resolveUnsure(evaluateCart(constraints, c), constraints, c, { provider: model({ required_attributes: ['no_match', 0.9] }) });
    assert.equal(status(g, 'required_attributes'), 'fail');
    assert.equal(g.verdict, 'block');
  });

  it('never overrides a failed deterministic check and does not call the model', async () => {
    const c = cart('White leather shoes', { unit_price: '200.00' });
    const before = evaluateCart(constraints, c);
    assert.equal(before.verdict, 'block');
    const m = model({ categories: ['match', 1] });
    assert.equal(await resolveUnsure(before, constraints, c, { provider: m }), before); // same object: untouched
    assert.equal(m.calls, 0);
  });

  it('never touches non-fuzzy rules such as the deadline', async () => {
    const withDeadline = { ...constraints, deadline: '2027-01-31T00:00:00Z' };
    const c = cart('White leather shoes');
    const g = await resolveUnsure(evaluateCart(withDeadline, c), withDeadline, c, {
      provider: model({ categories: ['match', 1], required_attributes: ['match', 1], deadline: ['match', 1] }),
    });
    assert.equal(status(g, 'deadline'), 'unsure');
    assert.equal(g.verdict, 'escalate');
  });

  it('when the model is unavailable the checks stay unsure (nothing is guessed)', async () => {
    const c = cart('White leather shoes');
    const before = evaluateCart(constraints, c);
    const { LlmError } = await import('../ai');
    const down: LlmProvider = {
      name: 'down',
      deterministic: false,
      complete: async () => {
        throw new LlmError('provider_error', 'LLM request timed out');
      },
    };
    assert.equal(await resolveUnsure(before, constraints, c, { provider: down }), before);
  });
});
