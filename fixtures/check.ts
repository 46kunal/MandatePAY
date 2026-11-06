// Verification: validates every fixture against the Zod contracts and checks 501 fallback.
// Run: npx tsx fixtures/check.ts
import {
  Cart,
  CaptureOrderResponse,
  CaseRecord,
  Constraints,
  GuardResult,
  PlaceOrderResponse,
  PollDisputesResponse,
  Verdict,
} from '../contracts/schemas';
import * as f from './index';
import { apiFetch, ApiClientError, fixtureFor } from './api';

const checks: [string, () => unknown | Promise<unknown>][] = [
  ['constraints', () => Constraints.parse(f.mandateConstraints)],
  ['carts', () => [f.cartAllowed, f.cartBlocked, f.cartNeedsApproval].map((c) => Cart.parse(c))],
  ['guards', () => [f.guardAllow, f.guardBlock, f.guardEscalate].map((g) => GuardResult.parse(g))],
  [
    'verdicts',
    () =>
      [f.verdictMerchantFault, f.verdictAgentError, f.verdictBuyerRegret, f.verdictWrongProduct].map((v) =>
        Verdict.parse(v),
      ),
  ],
  ['cases', () => f.cases.map((c) => CaseRecord.parse(c))],
  [
    'placeOrder',
    () => [PlaceOrderResponse.parse(f.placeOrderCreated), PlaceOrderResponse.parse(f.placeOrderNeedsApproval)],
  ],
  ['capture', () => CaptureOrderResponse.parse(f.captureResponse)],
  ['poll', () => PollDisputesResponse.parse(f.pollResponse)],
  [
    'fixtureFor covers every unbuilt route',
    () => {
      const routes: [string, string][] = [
        ['POST', '/api/mandates/draft'],
        ['POST', '/api/mandates'],
        ['POST', '/api/carts/check'],
        ['POST', '/api/orders'],
        ['POST', '/api/orders/X/capture'],
        ['POST', '/api/disputes/poll'],
        ['GET', '/api/cases'],
        ['GET', '/api/cases/PP-D-1001'],
        ['POST', '/api/cases/PP-D-1001/analyse'],
        ['POST', '/api/cases/PP-D-1001/act'],
        ['POST', '/api/demo/reset'],
      ];
      for (const [m, p] of routes) {
        if (fixtureFor(m, p, { cart: f.cartAllowed }) === undefined) throw new Error(`no fixture for ${m} ${p}`);
      }
    },
  ],
  [
    'apiFetch falls back on 501 and throws on other errors',
    async () => {
      const real = globalThis.fetch;
      try {
        globalThis.fetch = (async () => Response.json({ error: 'not_implemented' }, { status: 501 })) as typeof fetch;
        const r = await apiFetch('/api/cases');
        if (!r.fromFixture || (r.data as unknown[]).length !== f.cases.length) throw new Error('501 fallback failed');

        globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
        if (!(await apiFetch('/api/cases')).fromFixture) throw new Error('500 fallback failed');
        globalThis.fetch = (async () => {
          throw new TypeError('fetch failed');
        }) as typeof fetch;
        if (!(await apiFetch('/api/cases')).fromFixture) throw new Error('network fallback failed');

        globalThis.fetch = (async () => Response.json({ error: 'guard_blocked' }, { status: 422 })) as typeof fetch;
        try {
          await apiFetch('/api/orders', { body: { cart: f.cartBlocked } });
          throw new Error('expected throw');
        } catch (e) {
          if (!(e instanceof ApiClientError) || e.status !== 422) throw e;
        }

        globalThis.fetch = (async () => Response.json({ ok: true }, { status: 200 })) as typeof fetch;
        const live = await apiFetch('/api/health');
        if (live.fromFixture) throw new Error('should not use fixture on 200');
      } finally {
        globalThis.fetch = real;
      }
    },
  ],
];

async function main() {
  let failed = false;
  for (const [name, fn] of checks) {
    try {
      await fn();
      console.log('ok  ', name);
    } catch (e) {
      failed = true;
      console.error('FAIL', name, e);
    }
  }
  process.exit(failed ? 1 : 0);
}
void main();
