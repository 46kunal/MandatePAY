/**
 * The tools an outside AI agent gets over MCP (owner: orchestrator). They are deliberately narrow:
 *  - the agent works only inside mandates the buyer already signed (it cannot sign one);
 *  - prices and names come from the catalog, never from the agent;
 *  - the same cart guard that protects the buyer's own checkout runs on every cart;
 *  - the agent cannot pay: place_order returns a PayPal approval link that the buyer must open.
 * All data access goes through ToolDeps, so these are unit-tested with fakes.
 */
import { z } from 'zod';
import type { BuyerProduct, Cart, Constraints, GuardResult } from '../../contracts/schemas';
import { ToolError, type McpTool } from './protocol';

export interface AgentUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface ActiveMandate {
  mandate_id: string;
  request_text: string | null;
  constraints: Constraints;
  expires_at: string;
}

export type PlaceOutcome =
  | { kind: 'created'; orderId: string; approveUrl: string; guard: GuardResult }
  | { kind: 'needs_approval'; guard: GuardResult }
  | { kind: 'refused'; message: string; guard?: GuardResult };

export interface ToolDeps {
  listMandates(userId: string): Promise<ActiveMandate[]>;
  storeName(): Promise<string>;
  listProducts(currency?: string): Promise<BuyerProduct[]>;
  /** Who owns the mandate and which currency it is in; undefined when there is no such mandate. */
  mandateInfo(mandateId: string): Promise<{ userId: string; currency: string } | undefined>;
  checkCart(mandateId: string, cart: Cart): Promise<{ ok: true; guard: GuardResult } | { ok: false; message: string }>;
  placeOrder(mandateId: string, cart: Cart): Promise<PlaceOutcome>;
  getOrder(userId: string, orderId: string): Promise<{ order_id: string; paid: boolean; paypal_status: string; total: { value: string; currency: string }; items: string[] } | undefined>;
  appBaseUrl(): string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const Items = z
  .array(z.object({ sku: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(10) }).strict())
  .min(1)
  .max(20);
const CartArgs = z.object({ mandate_id: z.string().trim().min(1).max(64), items: Items }).strict();

/** Build a cart the same way the buyer's own page does: every name, price and attribute comes from the catalog. */
export function cartFromSkus(products: BuyerProduct[], items: { sku: string; quantity: number }[], seller: string, now = Date.now()): Cart {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.sku, (merged.get(i.sku) ?? 0) + i.quantity);
  const lines = [...merged.entries()].map(([sku, quantity]) => {
    const p = bySku.get(sku);
    if (!p) throw new ToolError(`There is no available product with SKU "${sku}". Call list_products to see what can be bought.`);
    if (quantity > p.max_quantity) throw new ToolError(`At most ${p.max_quantity} of "${p.name}" can be bought in one order.`);
    return { p, quantity };
  });
  const slowest = Math.max(...lines.map((l) => l.p.delivery_days));
  return {
    currency: lines[0].p.currency,
    items: lines.map(({ p, quantity }) => ({
      sku: p.sku,
      name: p.name,
      category: p.category,
      quantity,
      unit_price: p.unit_price,
      ...(Object.keys(p.attributes).length ? { attributes: p.attributes } : {}),
    })),
    delivery_eta: new Date(now + slowest * DAY_MS).toISOString(),
    merchant: seller,
  };
}

const summariseGuard = (g: GuardResult) => ({
  verdict: g.verdict,
  total: { value: g.total, currency: g.currency },
  checks: g.checks.map((c) => ({ rule: c.rule, status: c.status, detail: c.detail })),
});

export function makeTools(d: ToolDeps): McpTool<AgentUser>[] {
  /** The mandate must be this buyer's. Someone else's reads as not found, so ids cannot be probed. */
  async function ownMandate(user: AgentUser, mandateId: string) {
    const info = await d.mandateInfo(mandateId);
    if (!info || info.userId !== user.id) throw new ToolError(`No mandate with id ${mandateId} for this buyer. Call list_mandates.`);
    return info;
  }
  async function prepare(user: AgentUser, raw: unknown) {
    const args = CartArgs.safeParse(raw);
    if (!args.success) throw new ToolError(`Invalid arguments: ${args.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}`);
    const info = await ownMandate(user, args.data.mandate_id);
    const [products, seller] = await Promise.all([d.listProducts(info.currency), d.storeName()]);
    return { mandateId: args.data.mandate_id, cart: cartFromSkus(products, args.data.items, seller) };
  }

  const itemsSchema = {
    type: 'array',
    minItems: 1,
    maxItems: 20,
    description: 'The basket: SKUs from list_products with a quantity of 1 to 10.',
    items: {
      type: 'object',
      properties: { sku: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 10 } },
      required: ['sku', 'quantity'],
      additionalProperties: false,
    },
  };

  return [
    {
      name: 'list_mandates',
      description: "The buyer's active mandates: the spending limits they signed (budget, categories, required attributes, deadline). Start here: everything you buy must fit one of these.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      async run(_args, user) {
        const mandates = await d.listMandates(user.id);
        return {
          mandates,
          note: mandates.length ? undefined : 'The buyer has no active mandate. Ask them to create and sign one in MandatePay; you cannot sign one for them.',
        };
      },
    },
    {
      name: 'list_products',
      description: 'The store catalog a buyer may browse: name, price, attributes, delivery days, availability. Prices are fixed by the store.',
      inputSchema: {
        type: 'object',
        properties: { currency: { type: 'string', description: 'Three-letter code, for example USD. Use the mandate currency.' } },
        additionalProperties: false,
      },
      async run(raw) {
        const args = z.object({ currency: z.string().regex(/^[A-Z]{3}$/).optional() }).strict().safeParse(raw);
        if (!args.success) throw new ToolError('currency must be a three-letter code such as USD.');
        const [products, seller] = await Promise.all([d.listProducts(args.data.currency), d.storeName()]);
        return { seller, products };
      },
    },
    {
      name: 'check_cart',
      description: "Test a basket against a signed mandate without buying anything. Returns whether it is allowed, blocked, or needs the buyer's approval, with the reason for each rule.",
      inputSchema: {
        type: 'object',
        properties: { mandate_id: { type: 'string' }, items: itemsSchema },
        required: ['mandate_id', 'items'],
        additionalProperties: false,
      },
      async run(raw, user) {
        const { mandateId, cart } = await prepare(user, raw);
        const checked = await d.checkCart(mandateId, cart);
        if (!checked.ok) throw new ToolError(checked.message);
        return { ...summariseGuard(checked.guard), cart };
      },
    },
    {
      name: 'place_order',
      description:
        "Create the PayPal order for a basket that fits the mandate. You cannot pay: this returns an approval link, and the buyer must open it and approve the payment in PayPal. If the guard blocks the basket, nothing is created.",
      inputSchema: {
        type: 'object',
        properties: { mandate_id: { type: 'string' }, items: itemsSchema },
        required: ['mandate_id', 'items'],
        additionalProperties: false,
      },
      async run(raw, user) {
        const { mandateId, cart } = await prepare(user, raw);
        const out = await d.placeOrder(mandateId, cart);
        if (out.kind === 'refused') {
          const why = out.guard ? out.guard.checks.filter((c) => c.status === 'fail').map((c) => `${c.rule}: ${c.detail}`).join('; ') : '';
          throw new ToolError(`The order was not created. ${out.message}${why ? ` ${why}` : ''}`);
        }
        if (out.kind === 'needs_approval') {
          return {
            status: 'needs_buyer_approval',
            ...summariseGuard(out.guard),
            next_step: `This basket needs the buyer's own approval. Ask them to open ${d.appBaseUrl()}/buyer/shop and approve it there. You cannot approve it for them.`,
          };
        }
        return {
          status: 'created',
          order_id: out.orderId,
          approve_url: out.approveUrl,
          total: { value: out.guard.total, currency: out.guard.currency },
          next_step: 'Give approve_url to the buyer. Nothing is charged until they open it and approve the payment in PayPal. Then call get_order to see when it is paid.',
        };
      },
    },
    {
      name: 'get_order',
      description: "Whether an order you placed has been approved and paid by the buyer.",
      inputSchema: { type: 'object', properties: { order_id: { type: 'string' } }, required: ['order_id'], additionalProperties: false },
      async run(raw, user) {
        const args = z.object({ order_id: z.string().trim().min(1).max(64) }).strict().safeParse(raw);
        if (!args.success) throw new ToolError('order_id is required.');
        const o = await d.getOrder(user.id, args.data.order_id);
        if (!o) throw new ToolError(`No order with id ${args.data.order_id} for this buyer.`);
        return { ...o, status: o.paid ? 'paid' : 'awaiting_buyer_approval' };
      },
    },
  ];
}
