/** The real database, catalog, cart guard and PayPal behind the MCP tools (owner: orchestrator). */
import { getConfig } from '../config';
import { listShopProducts } from '../catalog/shop';
import { checkCartById } from '../mandate/check';
import { defaultDeps } from '../paypal/deps';
import { placeOrder } from '../paypal/service';
import { getSettings } from '../settings';
import type { ToolDeps } from './tools';

async function load() {
  const [{ and, desc, eq, gt, isNull }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  return { and, desc, eq, gt, isNull, db, schema };
}

export function realToolDeps(): ToolDeps {
  return {
    async listMandates(userId) {
      const { and, desc, eq, gt, isNull, db, schema } = await load();
      const m = schema.mandates;
      const rows = await db
        .select({ id: m.mandateId, requestText: m.requestText, constraints: m.constraints, expiresAt: m.expiresAt })
        .from(m)
        .where(and(eq(m.userId, userId), isNull(m.revokedAt), gt(m.expiresAt, new Date())))
        .orderBy(desc(m.createdAt))
        .limit(20);
      return rows.map((r) => ({ mandate_id: r.id, request_text: r.requestText, constraints: r.constraints, expires_at: r.expiresAt.toISOString() }));
    },
    async storeName() {
      return (await getSettings()).store_name?.trim() || 'MandatePay Store';
    },
    listProducts: (currency) => listShopProducts(currency),
    async mandateInfo(mandateId) {
      const { eq, db, schema } = await load();
      const [row] = await db
        .select({ userId: schema.mandates.userId, constraints: schema.mandates.constraints })
        .from(schema.mandates)
        .where(eq(schema.mandates.mandateId, mandateId))
        .limit(1);
      return row ? { userId: row.userId, currency: row.constraints.max_total.currency } : undefined;
    },
    async checkCart(mandateId, cart) {
      const r = await checkCartById(mandateId, cart);
      return r.ok ? { ok: true, guard: r.guard } : { ok: false, message: r.message };
    },
    async placeOrder(mandateId, cart) {
      // buyerApproved is always false here: an agent can never stand in for the buyer's own approval.
      const r = await placeOrder(defaultDeps(), { mandateId, cart, buyerApproved: false, funding: 'paypal' });
      if (!r.ok) return { kind: 'refused', message: r.message, guard: r.error === 'guard_blocked' ? (r.details as never) : undefined };
      if (r.status === 'needs_approval') return { kind: 'needs_approval', guard: r.guard };
      if (!r.approveUrl) return { kind: 'refused', message: 'PayPal gave no approval link for this order.' };
      return { kind: 'created', orderId: r.paypalOrderId, approveUrl: r.approveUrl, guard: r.guard };
    },
    async getOrder(userId, orderId) {
      const { eq, db, schema } = await load();
      const [row] = await db
        .select({ id: schema.orders.paypalOrderId, status: schema.orders.status, captureId: schema.orders.captureId, cart: schema.carts.cart, totalMinor: schema.carts.totalMinor, currency: schema.carts.currency, owner: schema.mandates.userId })
        .from(schema.orders)
        .innerJoin(schema.carts, eq(schema.carts.cartId, schema.orders.cartId))
        .innerJoin(schema.mandates, eq(schema.mandates.mandateId, schema.orders.mandateId))
        .where(eq(schema.orders.paypalOrderId, orderId))
        .limit(1);
      if (!row || row.owner !== userId) return undefined;
      return {
        order_id: row.id,
        paid: Boolean(row.captureId),
        paypal_status: row.status,
        total: { value: (row.totalMinor / 100).toFixed(2), currency: row.currency },
        items: row.cart.items.map((i) => (i.quantity > 1 ? `${i.quantity} x ${i.name}` : i.name)),
      };
    },
    appBaseUrl: () => (getConfig().APP_BASE_URL ?? 'https://mandate-pay.vercel.app').replace(/\/$/, ''),
  };
}
