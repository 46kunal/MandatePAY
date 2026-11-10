/**
 * Refunds on a payment (owner: A). PayPal is the source of truth: a refund can be made from MandatePay, but also from
 * the PayPal dashboard, which is outside our sight. We read the refunds off the PayPal order and keep a snapshot on the
 * order row, so the dispute page, the evidence, the AI analyst and the act guard all know what the buyer already got.
 *
 * The pure helpers (parse, summarise, cover) are unit-tested; the database and PayPal parts are thin.
 */
import { fromMinor, toMinor } from './orders';

export interface RefundRecord {
  id: string;
  status: string;
  amount_minor: number;
  currency: string;
  created_at: string | null;
}

/** How much of the disputed amount the refunds already return to the buyer. */
export type RefundCover = 'none' | 'partial' | 'full';

export interface RefundSummary {
  total_minor: number;
  currency: string | null;
  /** True while any counted refund is still PENDING (money on its way, not yet settled). */
  pending: boolean;
}

/** Statuses that mean the money is returned or on its way. FAILED and CANCELLED refunds do not count. */
const COUNTED = new Set(['COMPLETED', 'PENDING']);

/** Refunds from a PayPal order (purchase_units[].payments.refunds). Tolerates missing fields. */
export function parseRefunds(order: unknown): RefundRecord[] {
  const units = ((order as { purchase_units?: unknown[] } | null)?.purchase_units ?? []) as {
    payments?: { refunds?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string }; create_time?: string }[] };
  }[];
  const out: RefundRecord[] = [];
  for (const u of units) {
    for (const r of u.payments?.refunds ?? []) {
      if (!r.id || !r.amount?.value || !/^\d+(\.\d{1,2})?$/.test(r.amount.value)) continue;
      out.push({
        id: r.id,
        status: r.status ?? 'UNKNOWN',
        amount_minor: toMinor(Number(r.amount.value).toFixed(2)),
        currency: r.amount.currency_code ?? 'USD',
        created_at: r.create_time ?? null,
      });
    }
  }
  return out;
}

export function summariseRefunds(refunds: readonly RefundRecord[]): RefundSummary {
  const counted = refunds.filter((r) => COUNTED.has(r.status));
  return {
    total_minor: counted.reduce((n, r) => n + r.amount_minor, 0),
    currency: counted[0]?.currency ?? null,
    pending: counted.some((r) => r.status === 'PENDING'),
  };
}

/** Does the refunded total return all, part, or none of the disputed amount? */
export function refundCover(totalMinor: number, disputedMinor: number | null | undefined): RefundCover {
  if (totalMinor <= 0) return 'none';
  if (disputedMinor && totalMinor >= disputedMinor) return 'full';
  return 'partial';
}

/** What can still be refunded on a payment of `capturedMinor`. Never negative. */
export function refundableMinor(capturedMinor: number, refunds: readonly RefundRecord[]): number {
  return Math.max(0, capturedMinor - summariseRefunds(refunds).total_minor);
}

/** The view the dispute page and APIs use: null when nothing has been refunded. */
export function refundedView(
  refunds: readonly RefundRecord[],
  disputedMinor: number | null | undefined,
): { value: string; currency: string; pending: boolean; covers_dispute: RefundCover } | null {
  const s = summariseRefunds(refunds);
  if (s.total_minor <= 0 || !s.currency) return null;
  return { value: fromMinor(s.total_minor), currency: s.currency, pending: s.pending, covers_dispute: refundCover(s.total_minor, disputedMinor) };
}

// ---------- PayPal + database ----------

/** Re-read an order's refunds from PayPal and store them. A recent snapshot (younger than maxAgeMs) is reused. */
export async function refreshOrderRefunds(paypalOrderId: string, opts: { maxAgeMs?: number } = {}): Promise<RefundRecord[]> {
  const [{ eq }, { db, schema }, { getPayPalClient }] = await Promise.all([
    import('drizzle-orm'),
    import('../../db/client'),
    import('./client'),
  ]);
  const [row] = await db.select().from(schema.orders).where(eq(schema.orders.paypalOrderId, paypalOrderId)).limit(1);
  if (!row || !row.captureId) return row?.refunds ?? [];
  if (opts.maxAgeMs && row.refundsCheckedAt && Date.now() - row.refundsCheckedAt.getTime() < opts.maxAgeMs) return row.refunds;
  try {
    const order = await getPayPalClient().request(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
    const refunds = parseRefunds(order);
    await db.update(schema.orders).set({ refunds, refundsCheckedAt: new Date() }).where(eq(schema.orders.paypalOrderId, paypalOrderId));
    return refunds;
  } catch (err) {
    // PayPal being slow must not break reading a dispute: fall back to the last snapshot.
    console.error(`[refunds] could not read refunds for ${paypalOrderId}: ${(err as Error).message}`);
    return row.refunds ?? [];
  }
}

/** Refund (all or part of) a captured payment. PayPal-Request-Id makes a retried click safe. */
export async function refundCapture(
  captureId: string,
  input: { amountMinor?: number; currency: string; note?: string; requestId: string },
): Promise<{ id: string; status: string }> {
  const { getPayPalClient } = await import('./client');
  const data = await getPayPalClient().request<{ id?: string; status?: string }>(
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    {
      method: 'POST',
      body: {
        ...(input.amountMinor !== undefined ? { amount: { value: fromMinor(input.amountMinor), currency_code: input.currency } } : {}),
        ...(input.note ? { note_to_payer: input.note.slice(0, 255) } : {}),
      },
      requestId: input.requestId,
    },
  );
  return { id: data?.id ?? '', status: data?.status ?? 'UNKNOWN' };
}

/** Pure: decide how much to refund, or why not. Omitted amount = everything still refundable. */
export function planRefund(
  capturedMinor: number,
  refunds: readonly RefundRecord[],
  requestedMinor?: number,
):
  | { ok: true; amountMinor: number; remainingAfterMinor: number }
  | { ok: false; status: 409 | 422; error: string; message: string } {
  const remaining = refundableMinor(capturedMinor, refunds);
  if (remaining <= 0) return { ok: false, status: 409, error: 'fully_refunded', message: 'This payment has already been refunded in full.' };
  const amount = requestedMinor ?? remaining;
  if (amount <= 0) return { ok: false, status: 422, error: 'invalid_amount', message: 'The refund must be more than zero.' };
  if (amount > remaining) {
    return { ok: false, status: 422, error: 'refund_exceeds_remaining', message: `At most ${fromMinor(remaining)} can still be refunded on this payment.` };
  }
  return { ok: true, amountMinor: amount, remainingAfterMinor: remaining - amount };
}
