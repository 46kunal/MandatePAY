/**
 * Who owns a mandate or an order (owner: orchestrator). Carts and orders belong to a buyer through their mandate.
 * Buyers may only act on their own; a 404 is returned for someone else's, so ids cannot be probed.
 */
import { apiError } from '../http';

export async function mandateOwnerId(mandateId: string): Promise<string | undefined> {
  const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  const [row] = await db
    .select({ userId: schema.mandates.userId })
    .from(schema.mandates)
    .where(eq(schema.mandates.mandateId, mandateId))
    .limit(1);
  return row?.userId;
}

export async function orderOwnerId(paypalOrderId: string): Promise<string | undefined> {
  const [{ eq }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  const [row] = await db
    .select({ userId: schema.mandates.userId })
    .from(schema.orders)
    .innerJoin(schema.mandates, eq(schema.mandates.mandateId, schema.orders.mandateId))
    .where(eq(schema.orders.paypalOrderId, paypalOrderId))
    .limit(1);
  return row?.userId;
}

/** undefined when the user owns it; otherwise the 404 to return. */
export function notOwned(ownerId: string | undefined, userId: string, what: string, id: string): Response | undefined {
  return ownerId === userId ? undefined : apiError(404, `${what}_not_found`, `No ${what} with id ${id}.`);
}
