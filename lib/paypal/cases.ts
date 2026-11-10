/** Read side of disputes (owner: A): map case rows to the CaseRecord contract and load the detail view. */
import type { CaseRecord, Verdict } from '../../contracts/schemas';
import { payerCheck, type PayerCheck } from '../auth/paypalIdentity';
import { fromMinor } from './orders';

/** The columns of `cases` that the API exposes (a subset of the Drizzle row). */
export interface CaseRow {
  disputeId: string;
  captureId: string | null;
  paypalOrderId: string | null;
  mandateId: string | null;
  reason: string | null;
  stage: string | null;
  status: string | null;
  amountMinor: number | null;
  currency: string | null;
  verdict: unknown;
  analysisStatus: string;
  actionTaken: string | null;
  outcome: string | null;
  /** The user who sent the action to PayPal (null before sign-in existed or while not acted). */
  actedBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCaseRecord(row: CaseRow): CaseRecord {
  return {
    dispute_id: row.disputeId,
    capture_id: row.captureId,
    paypal_order_id: row.paypalOrderId,
    mandate_id: row.mandateId,
    reason: row.reason,
    stage: row.stage,
    status: row.status,
    amount:
      row.amountMinor !== null && row.currency ? { value: fromMinor(row.amountMinor), currency: row.currency } : null,
    verdict: (row.verdict as Verdict | null) ?? null,
    analysis_status: row.analysisStatus as CaseRecord['analysis_status'],
    action_taken: row.actionTaken,
    outcome: row.outcome,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Newest first. */
export async function listCaseRecords(): Promise<CaseRecord[]> {
  const [{ desc }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  const rows = await db.select().from(schema.cases).orderBy(desc(schema.cases.createdAt));
  return rows.map(toCaseRecord);
}

export interface CaseDetail extends CaseRecord {
  mandate: { mandate_id: string; buyer_ref: string; constraints: unknown; expires_at: string } | null;
  cart: { cart_id: string; cart: unknown; guard: unknown; approved_by: string | null; total_minor: number } | null;
  order: {
    paypal_order_id: string;
    status: string;
    capture_id: string | null;
    receipt_hash: string | null;
    captured_at: string | null;
    /** 'paypal' (PayPal account) or 'card' (guest card checkout); null for orders captured before this was recorded. */
    payment_source: string | null;
    /** Was it paid by the PayPal account the buyer linked to MandatePay? */
    payer_check: PayerCheck;
  } | null;
}

/** Case plus the mandate, cart and order it links to. Returns undefined for an unknown dispute id. */
export async function getCaseDetail(disputeId: string): Promise<CaseDetail | undefined> {
  const [{ eq, or }, { db, schema }] = await Promise.all([import('drizzle-orm'), import('../../db/client')]);
  const [row] = await db.select().from(schema.cases).where(eq(schema.cases.disputeId, disputeId)).limit(1);
  if (!row) return undefined;

  const [mandate] = row.mandateId
    ? await db.select().from(schema.mandates).where(eq(schema.mandates.mandateId, row.mandateId)).limit(1)
    : [];

  const match = [
    row.paypalOrderId ? eq(schema.orders.paypalOrderId, row.paypalOrderId) : undefined,
    row.captureId ? eq(schema.orders.captureId, row.captureId) : undefined,
  ].filter((c) => c !== undefined);
  const [order] = match.length ? await db.select().from(schema.orders).where(or(...match)).limit(1) : [];
  const [cart] = order ? await db.select().from(schema.carts).where(eq(schema.carts.cartId, order.cartId)).limit(1) : [];
  const [buyer] = mandate
    ? await db.select({ paypalPayerId: schema.users.paypalPayerId }).from(schema.users).where(eq(schema.users.id, mandate.userId)).limit(1)
    : [];

  return {
    ...toCaseRecord(row),
    // The signed token itself (mandates.jws) stays server-side.
    mandate: mandate
      ? {
          mandate_id: mandate.mandateId,
          buyer_ref: mandate.buyerRef,
          constraints: mandate.constraints,
          expires_at: mandate.expiresAt.toISOString(),
        }
      : null,
    cart: cart
      ? { cart_id: cart.cartId, cart: cart.cart, guard: cart.guard, approved_by: cart.approvedBy, total_minor: cart.totalMinor }
      : null,
    order: order
      ? {
          paypal_order_id: order.paypalOrderId,
          status: order.status,
          capture_id: order.captureId,
          receipt_hash: order.receiptHash,
          captured_at: order.capturedAt?.toISOString() ?? null,
          payment_source: order.paymentSource,
          payer_check: payerCheck(order.payerId, buyer?.paypalPayerId),
        }
      : null,
  };
}
