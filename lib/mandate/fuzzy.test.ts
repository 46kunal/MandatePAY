/** B7 checks. Run: npx tsx --test lib/mandate/fuzzy.test.ts (mock LLM, no key needed). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cart, Constraints } from '../../contracts/schemas';
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

const run = (c: Cart) => resolveUnsure(evaluateCart(constraints, c), constraints, c);
const status = (g: Awaited<ReturnType<typeof run>>, rule: string) => g.checks.find((x) => x.rule === rule)?.status;

describe('fuzzy matching (B7)', () => {
  it('settles unsure checks when the item name clearly matches', async () => {
    const c = cart('White leather shoes');
    assert.equal(evaluateCart(constraints, c).verdict, 'escalate');
    const g = await run(c);
    assert.equal(status(g, 'categories'), 'pass');
    assert.equal(status(g, 'required_attributes'), 'pass');
    assert.equal(g.verdict, 'allow');
    assert.match(g.checks.find((x) => x.rule === 'categories')!.detail, /AI judgement/);
  });

  it('leaves checks unsure (buyer decides) when the model cannot confirm', async () => {
    const g = await run(cart('Mystery footwear'));
    assert.equal(status(g, 'categories'), 'unsure');
    assert.equal(g.verdict, 'escalate');
  });

  it('never overrides a failed deterministic check and does not call the model', async () => {
    const c = cart('White leather shoes', { unit_price: '200.00' });
    const before = evaluateCart(constraints, c);
    assert.equal(before.verdict, 'block');
    assert.equal(await resolveUnsure(before, constraints, c), before); // same object: untouched
  });

  it('never touches non-fuzzy rules such as the deadline', async () => {
    const withDeadline = { ...constraints, deadline: '2027-01-31T00:00:00Z' };
    const c = cart('White leather shoes');
    const g = await resolveUnsure(evaluateCart(withDeadline, c), withDeadline, c);
    assert.equal(status(g, 'deadline'), 'unsure');
    assert.equal(g.verdict, 'escalate');
  });
});
