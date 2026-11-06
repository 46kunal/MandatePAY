/**
 * Analyst evaluation (owner: B, B10). Run: npm run eval   (add --verbose to list every case)
 *
 * Runs every case in eval/cases.json through analyseCase() and compares with the labels:
 *  - fault accuracy:        verdict.fault equals expect.fault
 *  - action accuracy:       verdict.action is one of expect.action
 *  - needs_human accuracy:  verdict.needs_human equals expect.needs_human (only for cases that set it)
 *  - overall:               a case passes only if every one of its checks passes
 *
 * LLM_PROVIDER=mock (the default) scores the offline stand-in, which is NOT a real judge. Set LLM_PROVIDER=anthropic
 * and LLM_API_KEY to score the real model, and report that number.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { analyseCase, type AnalystInput } from '../lib/analyst/analyst';
import { ActionType, OfferType, type Cart, type Constraints } from '../contracts/schemas';

interface EvalCase {
  id: string;
  note: string;
  reason: string;
  tracking?: { carrier?: string; number?: string; status?: string };
  amount: string;
  allowed_actions?: ActionType[];
  offer_types?: OfferType[];
  messages?: { from: string; text: string }[];
  mandate: Constraints;
  cart: { items: { name: string; unit_price: string; quantity?: number; attributes?: Record<string, string> }[]; merchant?: string };
  expect: { fault: string; action: ActionType[]; needs_human?: boolean };
}

const ALL_ACTIONS: ActionType[] = ['PROVIDE_EVIDENCE', 'MAKE_OFFER', 'ACCEPT_CLAIM', 'SEND_MESSAGE', 'NO_ACTION'];
const DEFAULT_OFFERS: OfferType[] = ['REFUND', 'REFUND_WITH_RETURN'];

function toInput(c: EvalCase): AnalystInput {
  const cart: Cart = {
    currency: 'GBP',
    merchant: c.cart.merchant,
    items: c.cart.items.map((i, n) => ({ sku: `sku${n + 1}`, quantity: 1, ...i })),
  };
  return {
    dispute: {
      dispute_id: `PP-EVAL-${c.id}`,
      reason: c.reason,
      stage: 'INQUIRY',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      amount: { value: c.amount, currency: 'GBP' },
      allowed_actions: c.allowed_actions ?? ALL_ACTIONS,
      offer_types: c.offer_types ?? DEFAULT_OFFERS,
      messages: c.messages ?? [],
      tracking: c.tracking,
    },
    mandate: { mandate_id: `mnd_eval_${c.id}`, constraints: c.mandate },
    cart,
  };
}

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}% (${n}/${d})`);

async function main() {
  const verbose = process.argv.includes('--verbose');
  const cases = JSON.parse(readFileSync(path.join(__dirname, 'cases.json'), 'utf8')) as EvalCase[];
  const provider = process.env.LLM_PROVIDER?.trim() || 'mock';

  let faultOk = 0;
  let actionOk = 0;
  let humanOk = 0;
  let humanTotal = 0;
  let allOk = 0;
  const failures: string[] = [];

  for (const c of cases) {
    const input = toInput(c);
    let line: string;
    try {
      const v = await analyseCase(input);
      const f = v.fault === c.expect.fault;
      const a = c.expect.action.includes(v.action);
      const h = c.expect.needs_human === undefined ? undefined : v.needs_human === c.expect.needs_human;
      // A disallowed action would be a guardrail bug, count it as a wrong action.
      const allowed = input.dispute.allowed_actions.includes(v.action);
      if (f) faultOk++;
      if (a && allowed) actionOk++;
      if (h !== undefined) {
        humanTotal++;
        if (h) humanOk++;
      }
      const pass = f && a && allowed && h !== false;
      if (pass) allOk++;
      const problems = [
        f ? '' : `fault ${v.fault} (want ${c.expect.fault})`,
        a && allowed ? '' : `action ${v.action} (want ${c.expect.action.join('|')})`,
        h === false ? `needs_human ${v.needs_human} (want ${c.expect.needs_human})` : '',
      ].filter(Boolean);
      line = `${pass ? 'PASS' : 'FAIL'}  ${c.id}${problems.length ? `  -> ${problems.join('; ')}` : ''}`;
      if (!pass) failures.push(line);
    } catch (err) {
      line = `ERROR ${c.id}  -> ${err instanceof Error ? err.message : String(err)}`;
      failures.push(line);
    }
    if (verbose) console.log(line);
  }

  console.log(`\nMandatePay analyst eval  (LLM_PROVIDER=${provider}, ${cases.length} cases)`);
  console.log(`  fault accuracy        ${pct(faultOk, cases.length)}`);
  console.log(`  action accuracy       ${pct(actionOk, cases.length)}`);
  console.log(`  needs_human accuracy  ${pct(humanOk, humanTotal)}`);
  console.log(`  overall (all checks)  ${pct(allOk, cases.length)}`);
  if (failures.length && !verbose) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f}`);
  }
  if (provider === 'mock') console.log('\nNote: this scores the offline mock, not a real model. Re-run with LLM_PROVIDER=anthropic for the real number.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
