/** Real dependencies for the order service: Postgres via Drizzle, PayPal via the shared client, B's mandate code. */
import type { Cart } from '../../contracts/schemas';
import { checkCart, computeReceiptHash, createClosedMandate, hashCart, verifyClosedMandate } from '../mandate';
import { getPayPalClient } from './client';
import { captureOrder, createOrder } from './orders';
import type { CartRow, LedgerStore, OrderDeps, OrderRow } from './service';

/** Drizzle-backed ledger. The DB client is imported lazily so unit tests never need DATABASE_URL. */
export function drizzleStore(): LedgerStore {
  const load = async () => {
    const [{ and, eq, isNull }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
    return { and, eq, isNull, db, schema };
  };

  return {
    async getMandate(mandateId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select().from(schema.mandates).where(eq(schema.mandates.mandateId, mandateId)).limit(1);
      return row ? { mandateId: row.mandateId, jws: row.jws } : undefined;
    },
    async getCart(cartId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select().from(schema.carts).where(eq(schema.carts.cartId, cartId)).limit(1);
      if (!row) return undefined;
      return {
        cartId: row.cartId,
        mandateId: row.mandateId,
        cart: row.cart as Cart,
        cartHash: row.cartHash,
        totalMinor: row.totalMinor,
        currency: row.currency,
        guard: row.guard,
        closedMandateJws: row.closedMandateJws,
        approvedBy: (row.approvedBy as CartRow['approvedBy']) ?? null,
      };
    },
    async getOrder(paypalOrderId) {
      const { eq, db, schema } = await load();
      const [row] = await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, paypalOrderId)).limit(1);
      return row as OrderRow | undefined;
    },
    async insertCart(row) {
      const { db, schema } = await load();
      await db.insert(schema.carts).values(row);
    },
    async insertOrder(row) {
      const { db, schema } = await load();
      await db.insert(schema.orders).values(row);
    },
    async markCaptured(paypalOrderId, fields) {
      const { and, eq, isNull, db, schema } = await load();
      const updated = await db
        .update(schema.orders)
        .set({ ...fields, capturedAt: new Date() })
        .where(and(eq(schema.orders.paypalOrderId, paypalOrderId), isNull(schema.orders.captureId)))
        .returning({ id: schema.orders.paypalOrderId });
      return updated.length > 0;
    },
  };
}

export function defaultDeps(): OrderDeps {
  const client = getPayPalClient();
  return {
    store: drizzleStore(),
    checkCart: (jws, cart) => checkCart(jws, cart),
    hashCart,
    createClosedMandate,
    verifyClosedMandate,
    computeReceiptHash,
    createOrder: (input) => createOrder(client, input),
    captureOrder: (id) => captureOrder(client, id),
  };
}
