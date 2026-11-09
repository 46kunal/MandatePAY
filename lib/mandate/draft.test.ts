/** B3 check. Run: npx tsx --test lib/mandate/draft.test.ts (LLM_PROVIDER unset, so it uses the mock). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Constraints } from '../../contracts/schemas';
import { draftMandate } from './draft';

describe('draftMandate (mock mode)', () => {
  it('turns free text into validated constraints and keeps the buyer words', async () => {
    const text = 'white trainers size 10 under $110, deliver by 2027-01-31';
    const { constraints, warnings } = await draftMandate(text);
    assert.ok(Constraints.safeParse(constraints).success);
    assert.deepEqual(constraints.max_total, { value: '110.00', currency: 'USD' });
    assert.deepEqual(constraints.required_attributes, { color: 'white', size: '10' });
    assert.equal(constraints.deadline, '2027-01-31T23:59:59Z');
    assert.equal(constraints.request_text, text);
    assert.ok(warnings.some((w) => /category/i.test(w)) || constraints.categories);
  });

  it('stays currency-agnostic: other symbols and codes keep their own currency', async () => {
    assert.deepEqual((await draftMandate('shoes under £80')).constraints.max_total, { value: '80.00', currency: 'GBP' });
    assert.deepEqual((await draftMandate('shoes under 80 EUR')).constraints.max_total, { value: '80.00', currency: 'EUR' });
  });

  it('warns when there is no budget in the request', async () => {
    const { warnings } = await draftMandate('some nice shoes please');
    assert.ok(warnings.some((w) => /budget/i.test(w)));
  });
});
