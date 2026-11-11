/** MCP server: keys, protocol and tools. Run: npx tsx --test lib/mcp.test.ts (no database, no network). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BuyerProduct, Cart, GuardResult } from '../contracts/schemas';
import { hashKey, KEY_PREFIX, looksLikeKey, newKey } from './mcp/keys';
import { handleRpc, ToolError } from './mcp/protocol';
import { cartFromSkus, makeTools, type AgentUser, type PlaceOutcome, type ToolDeps } from './mcp/tools';

const user: AgentUser = { id: 'u1', email: 'b@example.com', name: 'Buyer', role: 'buyer' };

const product = (over: Partial<BuyerProduct> = {}): BuyerProduct => ({
  sku: 'TR-W-10',
  name: 'Aero Runner',
  category: 'trainers',
  unit_price: '89.00',
  currency: 'USD',
  attributes: { color: 'white', size: '10' },
  delivery_days: 4,
  seller: 'Stride Lab',
  availability: 'in_stock',
  max_quantity: 5,
  ...over,
});

const allow: GuardResult = { verdict: 'allow', total: '89.00', currency: 'USD', checks: [{ rule: 'max_total', status: 'pass', detail: '89.00 within 110.00' }] };

function deps(over: Partial<ToolDeps> = {}) {
  const calls: { place: Cart[]; check: Cart[] } = { place: [], check: [] };
  const d: ToolDeps = {
    listMandates: async () => [],
    storeName: async () => 'Test Store',
    listProducts: async () => [product()],
    mandateInfo: async (id) => (id === 'mnd_mine' ? { userId: 'u1', currency: 'USD' } : id === 'mnd_other' ? { userId: 'u2', currency: 'USD' } : undefined),
    checkCart: async (_id, cart) => (calls.check.push(cart), { ok: true, guard: allow }),
    placeOrder: async (_id, cart): Promise<PlaceOutcome> => (calls.place.push(cart), { kind: 'created', orderId: 'ORDER1', approveUrl: 'https://paypal.example/approve?token=ORDER1', guard: allow }),
    getOrder: async (uid, id) => (uid === 'u1' && id === 'ORDER1' ? { order_id: 'ORDER1', paid: false, paypal_status: 'CREATED', total: { value: '89.00', currency: 'USD' }, items: ['Aero Runner'] } : undefined),
    appBaseUrl: () => 'https://mandate-pay.vercel.app',
    ...over,
  };
  return { d, calls, tools: makeTools(d) };
}

const call = (tools: ReturnType<typeof makeTools>, name: string, args: unknown) =>
  handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { user, tools });

const textOf = (r: Awaited<ReturnType<typeof call>>) => {
  const res = (r as { result: { content: { text: string }[]; isError?: boolean } }).result;
  return { text: res.content[0].text, isError: Boolean(res.isError) };
};

describe('agent keys', () => {
  it('makes a recognisable key and stores only its hash', () => {
    const k = newKey();
    assert.ok(k.key.startsWith(KEY_PREFIX) && looksLikeKey(k.key));
    assert.equal(k.hash, hashKey(k.key));
    assert.ok(!k.hash.includes(k.key));
    assert.equal(k.prefix, k.key.slice(0, 10));
    assert.notEqual(newKey().key, k.key);
  });
  it('rejects things that are not keys', () => {
    for (const t of ['', 'abc', 'Bearer x', 'mpk_', 'x'.repeat(200)]) assert.ok(!looksLikeKey(t), t);
  });
});

describe('the protocol', () => {
  const { tools } = deps();
  const run = (msg: unknown) => handleRpc(msg, { user, tools });

  it('initializes and agrees on a protocol version', async () => {
    const r = (await run({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })) as { result: { protocolVersion: string; serverInfo: { name: string }; instructions: string } };
    assert.equal(r.result.protocolVersion, '2025-03-26');
    assert.equal(r.result.serverInfo.name, 'mandatepay');
    assert.match(r.result.instructions, /cannot sign mandates or pay/);
    const unknown = (await run({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })) as { result: { protocolVersion: string } };
    assert.equal(unknown.result.protocolVersion, '2025-06-18');
  });
  it('answers ping and gives notifications no answer', async () => {
    assert.deepEqual(await run({ jsonrpc: '2.0', id: 3, method: 'ping' }), { jsonrpc: '2.0', id: 3, result: {} });
    assert.equal(await run({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  });
  it('lists exactly the five tools, none that signs or pays', async () => {
    const r = (await run({ jsonrpc: '2.0', id: 4, method: 'tools/list' })) as { result: { tools: { name: string; inputSchema: { type: string } }[] } };
    assert.deepEqual(r.result.tools.map((t) => t.name).sort(), ['check_cart', 'get_order', 'list_mandates', 'list_products', 'place_order']);
    assert.ok(r.result.tools.every((t) => t.inputSchema.type === 'object'));
  });
  it('reports bad requests, unknown methods and unknown tools as protocol errors', async () => {
    const bad = (await run('nope')) as { error: { code: number } };
    assert.equal(bad.error.code, -32600);
    const method = (await run({ jsonrpc: '2.0', id: 5, method: 'resources/list' })) as { error: { code: number } };
    assert.equal(method.error.code, -32601);
    const tool = (await run({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'sign_mandate', arguments: {} } })) as { error: { code: number } };
    assert.equal(tool.error.code, -32602);
  });
});

describe('building a cart from the catalog', () => {
  it('takes names, prices and attributes from the catalog, merging repeated SKUs', () => {
    const cart = cartFromSkus([product()], [{ sku: 'TR-W-10', quantity: 1 }, { sku: 'TR-W-10', quantity: 2 }], 'Test Store', Date.parse('2026-11-11T00:00:00Z'));
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 3);
    assert.equal(cart.items[0].unit_price, '89.00');
    assert.deepEqual(cart.items[0].attributes, { color: 'white', size: '10' });
    assert.equal(cart.merchant, 'Test Store');
    assert.equal(cart.delivery_eta, '2026-11-15T00:00:00.000Z');
  });
  it('refuses a SKU that is not for sale and more than the per-order limit', () => {
    assert.throws(() => cartFromSkus([product()], [{ sku: 'NOPE', quantity: 1 }], 's'), ToolError);
    assert.throws(() => cartFromSkus([product({ max_quantity: 2 })], [{ sku: 'TR-W-10', quantity: 3 }], 's'), /At most 2/);
  });
});

describe('the tools', () => {
  it('list_mandates tells an agent it cannot sign one when there is none', async () => {
    const { tools } = deps();
    assert.match(textOf(await call(tools, 'list_mandates', {})).text, /cannot sign one for them/);
  });

  it('check_cart works only on the buyer\'s own mandate, and never trusts a price from the agent', async () => {
    const { tools, calls } = deps();
    const other = textOf(await call(tools, 'check_cart', { mandate_id: 'mnd_other', items: [{ sku: 'TR-W-10', quantity: 1 }] }));
    assert.ok(other.isError && /No mandate with id mnd_other/.test(other.text));
    const missing = textOf(await call(tools, 'check_cart', { mandate_id: 'mnd_nope', items: [{ sku: 'TR-W-10', quantity: 1 }] }));
    assert.ok(missing.isError);
    const mine = textOf(await call(tools, 'check_cart', { mandate_id: 'mnd_mine', items: [{ sku: 'TR-W-10', quantity: 1 }] }));
    assert.ok(!mine.isError);
    assert.match(mine.text, /"verdict": "allow"/);
    assert.equal(calls.check[0].items[0].unit_price, '89.00');
    // extra fields (a price the agent made up) are refused outright
    const sneaky = textOf(await call(tools, 'check_cart', { mandate_id: 'mnd_mine', items: [{ sku: 'TR-W-10', quantity: 1, unit_price: '1.00' }] }));
    assert.ok(sneaky.isError && /Invalid arguments/.test(sneaky.text));
  });

  it('place_order returns an approval link for the buyer and says nothing is charged yet', async () => {
    const { tools, calls } = deps();
    const r = textOf(await call(tools, 'place_order', { mandate_id: 'mnd_mine', items: [{ sku: 'TR-W-10', quantity: 1 }] }));
    assert.ok(!r.isError);
    assert.match(r.text, /"approve_url": "https:\/\/paypal\.example\/approve/);
    assert.match(r.text, /Nothing is charged until they open it/);
    assert.equal(calls.place.length, 1);
  });

  it('place_order cannot create an order for someone else\'s mandate', async () => {
    const { tools, calls } = deps();
    const r = textOf(await call(tools, 'place_order', { mandate_id: 'mnd_other', items: [{ sku: 'TR-W-10', quantity: 1 }] }));
    assert.ok(r.isError);
    assert.equal(calls.place.length, 0);
  });

  it('place_order passes on a blocked cart as an error with the reason, and an escalation as a request for the buyer', async () => {
    const blocked: GuardResult = { verdict: 'block', total: '189.00', currency: 'USD', checks: [{ rule: 'max_total', status: 'fail', detail: '189.00 is over 110.00' }] };
    const b = deps({ placeOrder: async () => ({ kind: 'refused', message: 'The cart violates the mandate.', guard: blocked }) });
    const r1 = textOf(await call(b.tools, 'place_order', { mandate_id: 'mnd_mine', items: [{ sku: 'TR-W-10', quantity: 1 }] }));
    assert.ok(r1.isError && /over 110\.00/.test(r1.text));

    const esc: GuardResult = { ...allow, verdict: 'escalate' };
    const e = deps({ placeOrder: async () => ({ kind: 'needs_approval', guard: esc }) });
    const r2 = textOf(await call(e.tools, 'place_order', { mandate_id: 'mnd_mine', items: [{ sku: 'TR-W-10', quantity: 1 }] }));
    assert.ok(!r2.isError);
    assert.match(r2.text, /needs_buyer_approval/);
    assert.match(r2.text, /https:\/\/mandate-pay\.vercel\.app\/buyer\/shop/);
  });

  it('get_order shows the buyer\'s own order, and nobody else\'s', async () => {
    const { tools } = deps();
    const own = textOf(await call(tools, 'get_order', { order_id: 'ORDER1' }));
    assert.match(own.text, /awaiting_buyer_approval/);
    const stranger = await handleRpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_order', arguments: { order_id: 'ORDER1' } } }, { user: { ...user, id: 'u2' }, tools });
    assert.ok(textOf(stranger).isError);
  });

  it('an unexpected failure is reported in general words, not with internals', async () => {
    const { tools } = deps({ listProducts: async () => { throw new Error('connection string postgres://secret'); } });
    const r = textOf(await call(tools, 'list_products', {}));
    assert.ok(r.isError);
    assert.ok(!/postgres|secret/.test(r.text));
  });
});
