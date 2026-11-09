/** B3 checks. Run: npx tsx --test lib/mandate/draft.test.ts. A scripted provider stands in for the model; no network. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Constraints } from '../../contracts/schemas';
import type { LlmProvider, ProviderCall } from '../ai';
import { draftMandate } from './draft';

function answering(answer: unknown): LlmProvider & { calls: ProviderCall[] } {
  const calls: ProviderCall[] = [];
  return { name: 'scripted', deterministic: false, calls, complete: async (c) => (calls.push(c), answer) };
}

describe('draftMandate', () => {
  it('keeps the buyer words as request_text, never the model paraphrase', async () => {
    const text = 'white trainers size 10 under $110, deliver by 2027-01-31';
    const model = answering({
      constraints: {
        max_total: { value: '110.00', currency: 'USD' },
        categories: ['trainers'],
        required_attributes: { color: 'white', size: '10' },
        deadline: '2027-01-31',
        request_text: 'a paraphrase the model made up',
      },
      warnings: [],
    });
    const { constraints } = await draftMandate(text, { provider: model });
    assert.ok(Constraints.safeParse(constraints).success);
    assert.equal(constraints.request_text, text);
    assert.deepEqual(constraints.required_attributes, { color: 'white', size: '10' });
  });

  it("tells the model today's date and passes the request unchanged", async () => {
    const model = answering({ constraints: { max_total: { value: '50.00', currency: 'USD' } }, warnings: [] });
    await draftMandate('socks under 50 dollars by Nov 20', { provider: model });
    assert.match(model.calls[0].system, new RegExp(`Today's date is ${new Date().toISOString().slice(0, 10)}`));
    assert.equal(model.calls[0].user, 'socks under 50 dollars by Nov 20');
  });

  it("tells the model the store's category names so the guard can match them", async () => {
    const model = answering({ constraints: { max_total: { value: '110.00', currency: 'USD' } }, warnings: [] });
    await draftMandate('running trainers under 110', { provider: model, storeCategories: ['socks', 'trainers'], storeAttributes: ['color', 'size'] });
    assert.match(model.calls[0].system, /The store sells these categories: \["socks","trainers"\]/);
    assert.match(model.calls[0].system, /described by these attributes: \["color","size"\]/);
  });

  it('adds its own warnings for a missing number, deadline and category', async () => {
    const model = answering({ constraints: { max_total: { value: '40.00', currency: 'USD' } }, warnings: ['Budget assumed.'] });
    const { warnings } = await draftMandate('some nice shoes please', { provider: model });
    assert.ok(warnings.includes('Budget assumed.'));
    assert.ok(warnings.some((w) => /no number/i.test(w)));
    assert.ok(warnings.some((w) => /deadline/i.test(w)));
    assert.ok(warnings.some((w) => /category/i.test(w)));
  });

  it('rejects a model answer that breaks the contract', async () => {
    const model = answering({ constraints: { max_total: { value: '110', currency: 'dollars' } }, warnings: [] });
    await assert.rejects(draftMandate('shoes under 110', { provider: model }));
  });
});
