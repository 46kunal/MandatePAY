/**
 * A1 unit checks. Run: npx tsx --test lib/paypal/paypal.test.ts
 * No network and no PayPal credentials needed: fetch is replaced by a scripted fake.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cart } from '../../contracts/schemas';
import {
  PayPalClient,
  PayPalConfigError,
  PayPalError,
  acceptClaim,
  buildOrderPayload,
  captureOrder,
  cartTotalMinor,
  createOrder,
  deriveAllowedActions,
  deriveOfferTypes,
  fromMinor,
  listDisputes,
  makeOffer,
  provideEvidence,
  toDisputeSummary,
  toMinor,
  verifyWebhookSignature,
} from './index';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Responder = (call: Call) => { status?: number; json?: unknown; headers?: Record<string, string> };

/** A fake fetch that records calls and answers the OAuth endpoint itself unless the responder overrides it. */
function fakeFetch(respond: Responder, opts: { tokenTtl?: number } = {}) {
  const calls: Call[] = [];
  let tokenCount = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    };
    calls.push(call);
    let out: ReturnType<Responder>;
    if (call.url.endsWith('/v1/oauth2/token')) {
      tokenCount++;
      out = { json: { access_token: `tok-${tokenCount}`, expires_in: opts.tokenTtl ?? 3600 } };
    } else {
      out = respond(call);
    }
    return new Response(out.json === undefined ? '' : JSON.stringify(out.json), {
      status: out.status ?? 200,
      headers: out.headers,
    });
  }) as typeof fetch;
  return { impl, calls, apiCalls: () => calls.filter((c) => !c.url.endsWith('/v1/oauth2/token')), tokens: () => tokenCount };
}

const config = {
  baseUrl: 'https://api-m.sandbox.paypal.com',
  clientId: 'id',
  clientSecret: 'secret',
  webhookId: 'WH-1',
  appBaseUrl: 'http://localhost:3000',
};

const cart: Cart = {
  currency: 'USD',
  items: [
    { sku: 'SKU-1', name: 'White trainers', quantity: 2, unit_price: '45.10', attributes: { color: 'white' } },
    { sku: 'SKU-2', name: 'Laces', quantity: 1, unit_price: '3.05' },
  ],
};

describe('money helpers', () => {
  it('converts without floating point drift', () => {
    assert.equal(toMinor('0.10'), 10);
    assert.equal(toMinor('110.00'), 11000);
    assert.equal(fromMinor(5), '0.05');
    assert.equal(fromMinor(12345), '123.45');
    assert.equal(cartTotalMinor(cart), 2 * 4510 + 305);
  });
});

describe('client: configuration', () => {
  it('refuses a non-sandbox PayPal host', () => {
    assert.throws(
      () => new PayPalClient({ ...config, baseUrl: 'https://api-m.paypal.com' }),
      (e) => e instanceof PayPalConfigError,
    );
  });

  it('allows a local mock server', () => {
    assert.doesNotThrow(() => new PayPalClient({ ...config, baseUrl: 'http://localhost:4010/' }));
  });
});

describe('client: OAuth token cache', () => {
  it('fetches one token and reuses it across calls', async () => {
    const f = fakeFetch(() => ({ json: { ok: true } }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await client.request('/v1/ping');
    await client.request('/v1/ping');
    assert.equal(f.tokens(), 1);
    const basic = Buffer.from('id:secret').toString('base64');
    assert.equal(f.calls[0].headers.Authorization, `Basic ${basic}`);
    assert.equal(f.apiCalls()[0].headers.Authorization, 'Bearer tok-1');
  });

  it('shares one refresh between concurrent callers', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await Promise.all([client.request('/a'), client.request('/b'), client.request('/c')]);
    assert.equal(f.tokens(), 1);
  });

  it('refreshes after the token expires', async () => {
    let t = 0;
    const f = fakeFetch(() => ({ json: {} }), { tokenTtl: 120 }); // 120s minus 60s skew = 60s usable
    const client = new PayPalClient(config, { fetch: f.impl, now: () => t });
    await client.request('/a');
    t = 59_000;
    await client.request('/a');
    assert.equal(f.tokens(), 1);
    t = 61_000;
    await client.request('/a');
    assert.equal(f.tokens(), 2);
  });

  it('retries once with a new token on 401', async () => {
    let n = 0;
    const f = fakeFetch(() => (++n === 1 ? { status: 401, json: { name: 'AUTHENTICATION_FAILURE' } } : { json: { ok: 1 } }));
    const client = new PayPalClient(config, { fetch: f.impl });
    const out = await client.request<{ ok: number }>('/v1/x');
    assert.equal(out.ok, 1);
    assert.equal(f.tokens(), 2);
    assert.equal(f.apiCalls()[1].headers.Authorization, 'Bearer tok-2');
  });
});

describe('client: errors and idempotency', () => {
  it('turns a PayPal error body into PayPalError with debug id', async () => {
    const f = fakeFetch(() => ({
      status: 422,
      json: { name: 'UNPROCESSABLE_ENTITY', message: 'bad amount' },
      headers: { 'paypal-debug-id': 'dbg-9' },
    }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await assert.rejects(client.request('/v2/checkout/orders', { method: 'POST', body: {} }), (e) => {
      assert.ok(e instanceof PayPalError);
      assert.equal(e.status, 422);
      assert.equal(e.paypalName, 'UNPROCESSABLE_ENTITY');
      assert.equal(e.debugId, 'dbg-9');
      return true;
    });
  });

  it('wraps network failures as status 0', async () => {
    const failing = (async () => {
      throw new Error('boom');
    }) as unknown as typeof fetch;
    const client = new PayPalClient(config, { fetch: failing });
    await assert.rejects(client.request('/x'), (e) => e instanceof PayPalError && e.status === 0);
  });

  it('sends PayPal-Request-Id on POST (caller value wins) but not on GET', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await client.request('/p', { method: 'POST', body: {}, requestId: 'fixed' });
    await client.request('/p', { method: 'POST', body: {} });
    await client.request('/g');
    const [a, b, c] = f.apiCalls();
    assert.equal(a.headers['PayPal-Request-Id'], 'fixed');
    assert.match(b.headers['PayPal-Request-Id'], /^[0-9a-f-]{36}$/);
    assert.equal(c.headers['PayPal-Request-Id'], undefined);
  });
});

describe('orders', () => {
  it('builds a payload bound to mandate and cart with an exact item total', () => {
    const p = buildOrderPayload({ mandateId: 'mnd_1', cartId: 'cart_1', cart }, 'http://localhost:3000');
    const unit = p.purchase_units[0];
    assert.equal(unit.custom_id, 'mnd_1');
    assert.equal(unit.invoice_id, 'cart_1');
    assert.equal(unit.amount.value, '93.25');
    assert.equal(unit.amount.breakdown.item_total.value, '93.25');
    assert.equal(unit.items[0].quantity, '2');
    assert.equal(p.intent, 'CAPTURE');
  });

  it('creates an order and returns the approval link', async () => {
    const f = fakeFetch(() => ({
      status: 201,
      json: {
        id: 'ORDER1',
        status: 'PAYER_ACTION_REQUIRED',
        links: [
          { rel: 'self', href: 'https://x/self' },
          { rel: 'payer-action', href: 'https://sandbox.paypal.com/checkoutnow?token=ORDER1' },
        ],
      },
    }));
    const client = new PayPalClient(config, { fetch: f.impl });
    const out = await createOrder(client, { mandateId: 'mnd_1', cartId: 'cart_1', cart });
    assert.deepEqual(out, {
      paypalOrderId: 'ORDER1',
      status: 'PAYER_ACTION_REQUIRED',
      approveUrl: 'https://sandbox.paypal.com/checkoutnow?token=ORDER1',
    });
    const call = f.apiCalls()[0];
    assert.equal(call.headers['PayPal-Request-Id'], 'order-cart_1');
    assert.equal(JSON.parse(call.body!).purchase_units[0].custom_id, 'mnd_1');
  });

  it('fails clearly when PayPal returns no approval link', async () => {
    const f = fakeFetch(() => ({ json: { id: 'O', links: [] } }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await assert.rejects(createOrder(client, { mandateId: 'm', cartId: 'c', cart }), (e) => e instanceof PayPalError);
  });

  it('captures and returns the capture id with a per-order request id', async () => {
    const f = fakeFetch(() => ({
      status: 201,
      json: {
        id: 'ORDER1',
        status: 'COMPLETED',
        purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED' }] } }],
      },
    }));
    const client = new PayPalClient(config, { fetch: f.impl });
    const out = await captureOrder(client, 'ORDER1');
    assert.equal(out.captureId, 'CAP1');
    assert.equal(out.captureStatus, 'COMPLETED');
    assert.equal(f.apiCalls()[0].headers['PayPal-Request-Id'], 'capture-ORDER1');
    assert.ok(f.apiCalls()[0].url.endsWith('/v2/checkout/orders/ORDER1/capture'));
  });

  it('rejects a capture response without a capture id', async () => {
    const f = fakeFetch(() => ({ json: { id: 'ORDER1', status: 'COMPLETED', purchase_units: [{}] } }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await assert.rejects(captureOrder(client, 'ORDER1'), (e) => e instanceof PayPalError);
  });
});

describe('disputes mapping', () => {
  const raw = {
    dispute_id: 'PP-D-1',
    reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_life_cycle_stage: 'INQUIRY',
    dispute_amount: { currency_code: 'USD', value: '93.25' },
    disputed_transactions: [{ seller_transaction_id: 'CAP1' }],
    messages: [{ posted_by: 'BUYER', content: 'Wrong colour', time_posted: '2026-11-05T10:00:00Z' }],
    allowed_response_options: { make_offer: { offer_types: ['REFUND', 'REFUND_WITH_RETURN', 'NOT_A_REAL_TYPE'] } },
    links: [
      { rel: 'self', href: 'https://x' },
      { rel: 'provide-evidence', href: 'https://x/e' },
      { rel: 'make-offer', href: 'https://x/o' },
      { rel: 'send-message', href: 'https://x/m' },
    ],
  };

  it('derives allowed actions from links and always allows NO_ACTION', () => {
    const actions = deriveAllowedActions(raw);
    assert.deepEqual(new Set(actions), new Set(['PROVIDE_EVIDENCE', 'MAKE_OFFER', 'SEND_MESSAGE', 'NO_ACTION']));
    assert.ok(!actions.includes('ACCEPT_CLAIM'));
  });

  it('falls back to allowed_response_options keys when there are no links', () => {
    const actions = deriveAllowedActions({ allowed_response_options: { accept_claim: {}, send_message: {} } });
    assert.deepEqual(new Set(actions), new Set(['ACCEPT_CLAIM', 'SEND_MESSAGE', 'NO_ACTION']));
  });

  it('keeps only offer types the contract knows', () => {
    assert.deepEqual(deriveOfferTypes(raw), ['REFUND', 'REFUND_WITH_RETURN']);
    assert.deepEqual(deriveOfferTypes({}), []);
  });

  it('maps a dispute to the DisputeSummary contract', () => {
    const s = toDisputeSummary(raw);
    assert.equal(s.dispute_id, 'PP-D-1');
    assert.equal(s.stage, 'INQUIRY');
    assert.deepEqual(s.amount, { value: '93.25', currency: 'USD' });
    assert.equal(s.seller_transaction_id, 'CAP1');
    assert.deepEqual(s.messages, [{ from: 'BUYER', text: 'Wrong colour', at: '2026-11-05T10:00:00Z' }]);
  });

  it('tolerates a sparse dispute', () => {
    const s = toDisputeSummary({ dispute_id: 'PP-D-2' });
    assert.equal(s.reason, 'UNKNOWN');
    assert.equal(s.seller_transaction_id, undefined);
    assert.deepEqual(s.allowed_actions, ['NO_ACTION']);
  });
});

describe('disputes calls', () => {
  it('lists disputes with paging params and tolerates an empty result', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient(config, { fetch: f.impl });
    assert.deepEqual(await listDisputes(client, { pageSize: 10 }), []);
    assert.ok(f.apiCalls()[0].url.includes('page_size=10'));
  });

  it('sends a make-offer body in PayPal shape with a stable request id', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await makeOffer(client, 'PP-D-1', { note: 'Sorry', offerType: 'REFUND', amount: { value: '10.00', currency: 'USD' } });
    const c = f.apiCalls()[0];
    assert.ok(c.url.endsWith('/v1/customer/disputes/PP-D-1/make-offer'));
    assert.deepEqual(JSON.parse(c.body!), {
      note: 'Sorry',
      offer_type: 'REFUND',
      offer_amount: { currency_code: 'USD', value: '10.00' },
    });
    assert.equal(c.headers['PayPal-Request-Id'], 'offer-PP-D-1-REFUND-10.00');
  });

  it('accept-claim uses a per-dispute request id', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await acceptClaim(client, 'PP-D-1', 'ok');
    assert.equal(f.apiCalls()[0].headers['PayPal-Request-Id'], 'accept-PP-D-1');
  });

  it('provide-evidence without files sends plain JSON', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient(config, { fetch: f.impl });
    await provideEvidence(client, 'PP-D-1', 'Delivered on time.');
    const c = f.apiCalls()[0];
    assert.equal(c.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(c.body!), { evidences: [{ evidence_type: 'OTHER', notes: 'Delivered on time.' }] });
  });

  it('provide-evidence with a PDF sends multipart: an input JSON part and file1, listed in documents', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient(config, { fetch: f.impl });
    const bytes = new TextEncoder().encode('%PDF-1.4 test');
    await provideEvidence(client, 'PP-D-1', 'See the evidence pack.', [
      { filename: 'evidence-PP-D-1.pdf', contentType: 'application/pdf', bytes },
    ]);
    const c = f.apiCalls()[0];
    const form = c.body as unknown as FormData;
    assert.ok(form instanceof FormData);
    assert.equal(c.headers['Content-Type'], undefined); // fetch adds the multipart boundary itself
    const input = JSON.parse(await (form.get('input') as Blob).text());
    assert.deepEqual(input.evidences[0].documents, [{ name: 'evidence-PP-D-1.pdf' }]);
    assert.equal(input.evidences[0].notes, 'See the evidence pack.');
    const file = form.get('file1') as File;
    assert.equal(file.name, 'evidence-PP-D-1.pdf');
    assert.equal(file.type, 'application/pdf');
    assert.equal(await file.text(), '%PDF-1.4 test');
    assert.match(c.headers['PayPal-Request-Id'], /^evidence-PP-D-1-/);
  });
});

describe('webhook verification', () => {
  const headers = new Headers({
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-sig': 'sig',
    'paypal-transmission-time': '2026-11-05T10:00:00Z',
  });

  it('is true only on SUCCESS and forwards the event', async () => {
    const f = fakeFetch(() => ({ json: { verification_status: 'SUCCESS' } }));
    const client = new PayPalClient(config, { fetch: f.impl });
    assert.equal(await verifyWebhookSignature(client, headers, { id: 'WH-EVT-1' }), true);
    const body = JSON.parse(f.apiCalls()[0].body!);
    assert.equal(body.webhook_id, 'WH-1');
    assert.deepEqual(body.webhook_event, { id: 'WH-EVT-1' });
  });

  it('is false on FAILURE', async () => {
    const f = fakeFetch(() => ({ json: { verification_status: 'FAILURE' } }));
    const client = new PayPalClient(config, { fetch: f.impl });
    assert.equal(await verifyWebhookSignature(client, headers, {}), false);
  });

  it('is false without calling PayPal when signature headers are missing', async () => {
    const f = fakeFetch(() => ({ json: { verification_status: 'SUCCESS' } }));
    const client = new PayPalClient(config, { fetch: f.impl });
    assert.equal(await verifyWebhookSignature(client, new Headers(), {}), false);
    assert.equal(f.apiCalls().length, 0);
  });

  it('throws a config error when no webhook id is configured', async () => {
    const f = fakeFetch(() => ({ json: {} }));
    const client = new PayPalClient({ ...config, webhookId: undefined }, { fetch: f.impl });
    await assert.rejects(verifyWebhookSignature(client, headers, {}), (e) => e instanceof PayPalConfigError);
  });
});
