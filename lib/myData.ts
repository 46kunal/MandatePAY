/**
 * A buyer's own data (owner: orchestrator): their mandates for the account page, revoking one, and a full export.
 * Every query filters by the buyer's user id.
 */
import type { MyMandate } from '../contracts/schemas';
import type { Constraints } from '../contracts/schemas';

interface MandateRow {
  mandateId: string;
  requestText: string | null;
  constraints: Constraints;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function mandateStatus(m: Pick<MandateRow, 'expiresAt' | 'revokedAt'>, now = new Date()): MyMandate['status'] {
  if (m.revokedAt) return 'revoked';
  return m.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
}

export function toMyMandate(m: MandateRow, orders: number, now = new Date()): MyMandate {
  return {
    mandate_id: m.mandateId,
    request_text: m.requestText,
    max_total: m.constraints.max_total,
    status: mandateStatus(m, now),
    created_at: m.createdAt.toISOString(),
    expires_at: m.expiresAt.toISOString(),
    revoked_at: m.revokedAt ? m.revokedAt.toISOString() : null,
    orders,
  };
}

async function load() {
  const [orm, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../db/client')]);
  return { ...orm, db, schema };
}

export async function listMyMandates(userId: string): Promise<MyMandate[]> {
  const { db, schema, eq, desc, count } = await load();
  const m = schema.mandates;
  const rows = await db
    .select({
      mandateId: m.mandateId,
      requestText: m.requestText,
      constraints: m.constraints,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
      revokedAt: m.revokedAt,
      orders: count(schema.orders.paypalOrderId),
    })
    .from(m)
    .leftJoin(schema.orders, eq(schema.orders.mandateId, m.mandateId))
    .where(eq(m.userId, userId))
    .groupBy(m.mandateId)
    .orderBy(desc(m.createdAt))
    .limit(200);
  return rows.map((r) => toMyMandate(r, Number(r.orders)));
}

/** true when revoked now, false when it was already revoked. undefined when it is not this buyer's mandate. */
export async function revokeMyMandate(userId: string, mandateId: string): Promise<boolean | undefined> {
  const { db, schema, and, eq, isNull } = await load();
  const m = schema.mandates;
  const [own] = await db.select({ revokedAt: m.revokedAt }).from(m).where(and(eq(m.mandateId, mandateId), eq(m.userId, userId))).limit(1);
  if (!own) return undefined;
  if (own.revokedAt) return false;
  const updated = await db
    .update(m)
    .set({ revokedAt: new Date() })
    .where(and(eq(m.mandateId, mandateId), eq(m.userId, userId), isNull(m.revokedAt)))
    .returning({ id: m.mandateId });
  return updated.length > 0;
}

/** Everything stored about this buyer, as one JSON document. Signed tokens are left out; they are not personal data. */
export async function exportMyData(userId: string) {
  const { db, schema, eq, inArray } = await load();
  const [user] = await db
    .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.users.role, created_at: schema.users.createdAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const mandates = await db
    .select({
      mandate_id: schema.mandates.mandateId,
      request_text: schema.mandates.requestText,
      constraints: schema.mandates.constraints,
      created_at: schema.mandates.createdAt,
      expires_at: schema.mandates.expiresAt,
      revoked_at: schema.mandates.revokedAt,
    })
    .from(schema.mandates)
    .where(eq(schema.mandates.userId, userId));
  const ids = mandates.map((x) => x.mandate_id);
  const carts = ids.length
    ? await db
        .select({ cart_id: schema.carts.cartId, mandate_id: schema.carts.mandateId, cart: schema.carts.cart, guard: schema.carts.guard, created_at: schema.carts.createdAt })
        .from(schema.carts)
        .where(inArray(schema.carts.mandateId, ids))
    : [];
  const orders = ids.length
    ? await db
        .select({
          paypal_order_id: schema.orders.paypalOrderId,
          cart_id: schema.orders.cartId,
          mandate_id: schema.orders.mandateId,
          status: schema.orders.status,
          capture_id: schema.orders.captureId,
          created_at: schema.orders.createdAt,
          captured_at: schema.orders.capturedAt,
        })
        .from(schema.orders)
        .where(inArray(schema.orders.mandateId, ids))
    : [];
  return { exported_at: new Date().toISOString(), account: user ?? null, mandates, carts, orders };
}
