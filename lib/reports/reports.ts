/**
 * Buyer problem reports (owner: orchestrator). A buyer reports a problem on one of their own paid orders; the store
 * answers with a refund (through PayPal) or a reply. Buyer queries always filter by the buyer's user id.
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { MyOrder, ProblemKind, ProblemReport } from '../../contracts/schemas';
import { db, schema } from '../../db/client';
import { audit, type AuditActor } from '../audit';
import { fromMinor } from '../paypal/orders';
import { summariseRefunds } from '../paypal/refunds';
import { assessReport, toProblemReport } from './assess';

/** The buyer's paid orders, newest first, each with its latest report. */
export async function listMyOrders(userId: string): Promise<MyOrder[]> {
  const rows = await db
    .select({
      paypalOrderId: schema.orders.paypalOrderId,
      status: schema.orders.status,
      capturedAt: schema.orders.capturedAt,
      refunds: schema.orders.refunds,
      cart: schema.carts.cart,
      totalMinor: schema.carts.totalMinor,
      currency: schema.carts.currency,
    })
    .from(schema.orders)
    .innerJoin(schema.mandates, eq(schema.mandates.mandateId, schema.orders.mandateId))
    .innerJoin(schema.carts, eq(schema.carts.cartId, schema.orders.cartId))
    .where(and(eq(schema.mandates.userId, userId), isNotNull(schema.orders.captureId)))
    .orderBy(desc(schema.orders.createdAt))
    .limit(100);
  const ids = rows.map((r) => r.paypalOrderId);
  const reports = ids.length
    ? await db.select().from(schema.problemReports).where(inArray(schema.problemReports.paypalOrderId, ids)).orderBy(desc(schema.problemReports.createdAt))
    : [];
  return rows.map((r) => {
    const latest = reports.find((x) => x.paypalOrderId === r.paypalOrderId);
    const refunded = summariseRefunds(r.refunds ?? []).total_minor;
    return {
      paypal_order_id: r.paypalOrderId,
      items: r.cart.items.map((i) => (i.quantity > 1 ? `${i.quantity} x ${i.name}` : i.name)),
      total: { value: fromMinor(r.totalMinor), currency: r.currency },
      status: r.status,
      paid_at: r.capturedAt ? r.capturedAt.toISOString() : null,
      refunded: refunded > 0 ? fromMinor(refunded) : null,
      report: latest ? toProblemReport(latest, r.currency) : null,
    };
  });
}

export type CreateReportResult = { ok: true; report: ProblemReport } | { ok: false; status: number; error: string; message: string };

export async function createReport(user: AuditActor, orderId: string, kind: ProblemKind, message: string): Promise<CreateReportResult> {
  const [row] = await db
    .select({ order: schema.orders, guard: schema.carts.guard, currency: schema.carts.currency })
    .from(schema.orders)
    .innerJoin(schema.mandates, eq(schema.mandates.mandateId, schema.orders.mandateId))
    .innerJoin(schema.carts, eq(schema.carts.cartId, schema.orders.cartId))
    .where(and(eq(schema.orders.paypalOrderId, orderId), eq(schema.mandates.userId, user.id)))
    .limit(1);
  // Another buyer's order reads as not found, so ids cannot be probed.
  if (!row) return { ok: false, status: 404, error: 'order_not_found', message: 'No order of yours with that id.' };
  if (!row.order.captureId) return { ok: false, status: 409, error: 'not_paid', message: 'This order was not paid, so there is nothing to report.' };
  const [open] = await db
    .select({ id: schema.problemReports.reportId })
    .from(schema.problemReports)
    .where(and(eq(schema.problemReports.paypalOrderId, orderId), eq(schema.problemReports.status, 'open')))
    .limit(1);
  if (open) return { ok: false, status: 409, error: 'report_open', message: 'You already reported a problem with this order. The store will answer it here.' };

  const values = {
    reportId: `rpt_${randomBytes(8).toString('hex')}`,
    paypalOrderId: orderId,
    userId: user.id,
    kind,
    message,
    assessment: assessReport(kind, row.guard),
  };
  const [saved] = await db.insert(schema.problemReports).values(values).returning();
  await audit(user, { action: 'report.create', targetType: 'order', targetId: orderId, details: { report_id: values.reportId, kind, agent_mistake: values.assessment.agent_mistake } });
  return { ok: true, report: toProblemReport(saved, row.currency) };
}

/** Every report for the merchant, open ones first, then newest. */
export async function listReports(): Promise<ProblemReport[]> {
  const rows = await db
    .select({ r: schema.problemReports, email: schema.users.email, cart: schema.carts.cart, totalMinor: schema.carts.totalMinor, currency: schema.carts.currency })
    .from(schema.problemReports)
    .innerJoin(schema.users, eq(schema.users.id, schema.problemReports.userId))
    .innerJoin(schema.orders, eq(schema.orders.paypalOrderId, schema.problemReports.paypalOrderId))
    .innerJoin(schema.carts, eq(schema.carts.cartId, schema.orders.cartId))
    .orderBy(desc(schema.problemReports.createdAt))
    .limit(200);
  const out = rows.map((x) => ({
    ...toProblemReport(x.r, x.currency),
    buyer_email: x.email,
    order_total: { value: fromMinor(x.totalMinor), currency: x.currency },
    items: x.cart.items.map((i) => (i.quantity > 1 ? `${i.quantity} x ${i.name}` : i.name)),
  }));
  return [...out.filter((r) => r.status === 'open'), ...out.filter((r) => r.status !== 'open')];
}

export async function getReport(reportId: string) {
  const [r] = await db.select().from(schema.problemReports).where(eq(schema.problemReports.reportId, reportId)).limit(1);
  return r ?? null;
}

/** Marks an open report answered. false when it was already answered (a second click). */
export async function markResolved(
  actor: AuditActor,
  reportId: string,
  v: { status: 'refunded' | 'closed'; reply: string; refundId?: string; refundMinor?: number },
): Promise<boolean> {
  const updated = await db
    .update(schema.problemReports)
    .set({ status: v.status, reply: v.reply, refundId: v.refundId ?? null, refundMinor: v.refundMinor ?? null, resolvedBy: actor.id, resolvedAt: new Date() })
    .where(and(eq(schema.problemReports.reportId, reportId), eq(schema.problemReports.status, 'open')))
    .returning({ id: schema.problemReports.reportId });
  if (updated.length) await audit(actor, { action: 'report.resolve', targetType: 'report', targetId: reportId, details: { status: v.status, refund_id: v.refundId ?? null } });
  return updated.length > 0;
}
