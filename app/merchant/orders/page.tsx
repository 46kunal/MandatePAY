'use client';
// OWNER: C. Orders: every order placed through MandatePay (GET /api/orders), newest first, with its payment state
// and any dispute on it.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { OrderSummary } from '@/contracts/schemas';
import { useSession } from '@/lib/auth/client';
import { can } from '@/lib/auth/roles';
import { apiFetch } from '../../_ui/api';
import { Dialog } from '../../_ui/Dialog';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import { formatDateTime, formatMoney } from '../../_ui/labels';
import { shortHash } from '../../_ui/parse';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

/** An unpaid order older than this can no longer be approved by the buyer: it is an abandoned checkout. */
const ABANDONED_AFTER_MS = 3 * 60 * 60 * 1000;

function isAbandoned(o: OrderSummary, now: number): boolean {
  return !o.capture_id && o.status !== 'APPROVED' && now - Date.parse(o.created_at) > ABANDONED_AFTER_MS;
}

/** PayPal order status in words a merchant uses. */
function paymentLabel(status: string): { text: string; tone: 'good' | 'warn' | 'neutral' } {
  switch (status) {
    case 'COMPLETED':
      return { text: 'Paid', tone: 'good' };
    case 'APPROVED':
      return { text: 'Approved, not captured', tone: 'warn' };
    case 'PAYER_ACTION_REQUIRED':
    case 'CREATED':
      return { text: 'Awaiting buyer', tone: 'neutral' };
    case 'VOIDED':
      return { text: 'Voided', tone: 'neutral' };
    default:
      return { text: status, tone: 'neutral' };
  }
}

/** Cents arithmetic for the refund form (amounts are strings with two decimals). */
const cents = (v: string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

interface RefundDraft {
  order: OrderSummary;
  amount: string;
  note: string;
  key: string;
}

export default function OrdersPage() {
  const { data: session } = useSession();
  const canRefund = can((session?.user as { role?: string } | undefined)?.role, 'orders:refund');
  const [refund, setRefund] = useState<RefundDraft | null>(null);
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundMsg, setRefundMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [orders, setOrders] = useState<OrderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAbandoned, setShowAbandoned] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrders((await apiFetch<{ orders: OrderSummary[] }>('/api/orders')).data.orders);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const remainingOf = (o: OrderSummary) => Math.max(0, cents(o.total) - (o.refunded ? cents(o.refunded) : 0));

  function openRefund(o: OrderSummary) {
    setRefundMsg(null);
    setRefund({ order: o, amount: fromCents(remainingOf(o)), note: '', key: crypto.randomUUID() });
  }

  async function sendRefund() {
    if (!refund) return;
    const remaining = remainingOf(refund.order);
    if (!/^\d+(\.\d{1,2})?$/.test(refund.amount.trim()) || cents(refund.amount) <= 0 || cents(refund.amount) > remaining) {
      setRefundMsg({ ok: false, text: `Enter an amount between 0.01 and ${fromCents(remaining)}.` });
      return;
    }
    setRefundBusy(true);
    setRefundMsg(null);
    try {
      const amount = fromCents(cents(refund.amount));
      const r = await apiFetch<{ status: string; amount: string; currency: string; remaining: string }>(
        `/api/orders/${encodeURIComponent(refund.order.paypal_order_id)}/refund`,
        {
          method: 'POST',
          body: {
            ...(cents(amount) === remaining ? {} : { amount }),
            ...(refund.note.trim() ? { note: refund.note.trim() } : {}),
            idempotency_key: refund.key,
          },
        },
      );
      setRefundMsg({
        ok: true,
        text: `Refunded ${formatMoney(r.data.amount, r.data.currency)} (${r.data.status.toLowerCase()} at PayPal). ${formatMoney(r.data.remaining, r.data.currency)} can still be refunded.`,
      });
      setRefund(null);
      void load();
    } catch (e) {
      setRefundMsg({ ok: false, text: (e as Error).message });
    } finally {
      setRefundBusy(false);
    }
  }

  const abandoned = orders?.filter((o) => isAbandoned(o, now)).length ?? 0;
  const rows = orders?.filter((o) => showAbandoned || !isAbandoned(o, now)) ?? null;
  const paidCount = orders?.filter((o) => o.status === 'COMPLETED').length ?? 0;

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order placed through MandatePay, newest first, with its payment and any dispute." />
      {refundMsg && !refund && (
        <Notice tone={refundMsg.ok ? 'good' : 'bad'} alert={!refundMsg.ok}>
          {refundMsg.text}
        </Notice>
      )}
      {error && (
        <Notice tone="bad" alert>
          Could not load orders: {error}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={load}>
            Try again
          </button>
        </Notice>
      )}

      {!orders && !error && (
        <div className={m.skelStack} aria-busy="true" aria-label="Loading orders">
          <Skeleton height={40} />
          <Skeleton height={56} />
        </div>
      )}

      {orders && orders.length === 0 && (
        <Card>
          <EmptyState title="No orders yet">Orders appear here when a buyer checks out with PayPal.</EmptyState>
        </Card>
      )}

      {rows && orders && orders.length > 0 && (
        <Card
          flush
          title={`${orders.length - abandoned} order${orders.length - abandoned === 1 ? '' : 's'} · ${paidCount} paid`}
          actions={
            abandoned > 0 ? (
              <label className={u.muted} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input type="checkbox" checked={showAbandoned} onChange={(e) => setShowAbandoned(e.target.checked)} />
                Show {abandoned} abandoned checkout{abandoned === 1 ? '' : 's'}
              </label>
            ) : undefined
          }
        >
          <div className={u.tableWrap}>
            {rows.length === 0 && (
              <div style={{ padding: '1rem' }}>
                <EmptyState title="No current orders">Only abandoned checkouts so far. Tick the box above to see them.</EmptyState>
              </div>
            )}
            <table className={u.table} hidden={rows.length === 0}>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Items</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Refunded</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Placed</th>
                  <th scope="col">Captured</th>
                  <th scope="col">Receipt hash</th>
                  <th scope="col">Dispute</th>
                  {canRefund && (
                    <th scope="col">
                      <span className={u.srOnly}>Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const p = isAbandoned(o, now) ? { text: 'Abandoned', tone: 'neutral' as const } : paymentLabel(o.status);
                  return (
                    <tr key={o.paypal_order_id}>
                      <td className={u.mono} title={o.capture_id ? `Capture ${o.capture_id}` : undefined}>
                        {o.paypal_order_id}
                      </td>
                      <td>{o.items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name)).join(', ')}</td>
                      <td className={u.num}>{formatMoney(o.total, o.currency)}</td>
                      <td className={u.num}>
                        {o.refunded ? (
                          <>
                            {formatMoney(o.refunded, o.currency)}
                            {o.refund_pending && <div className={u.muted}>pending</div>}
                          </>
                        ) : (
                          <span className={u.muted}>—</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={p.tone}>{p.text}</Badge>
                      </td>
                      <td className={u.muted}>{formatDateTime(o.created_at)}</td>
                      <td className={u.muted}>{formatDateTime(o.captured_at) || '—'}</td>
                      <td className={u.mono} title={o.receipt_hash}>
                        {shortHash(o.receipt_hash) || '—'}
                      </td>
                      <td>
                        {o.dispute_id ? (
                          <Link href={`/merchant/disputes/${encodeURIComponent(o.dispute_id)}`} className={u.rowLink}>
                            {o.dispute_id}
                          </Link>
                        ) : (
                          <span className={u.muted}>None</span>
                        )}
                      </td>
                      {canRefund && (
                        <td style={{ textAlign: 'right' }}>
                          {o.capture_id && remainingOf(o) > 0 && (
                            <button className={`${u.btn} ${u.btnSecondary}`} type="button" onClick={() => openRefund(o)}>
                              Refund
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog
        open={refund !== null}
        title="Refund through PayPal"
        onClose={() => (refundBusy ? undefined : setRefund(null))}
        footer={
          <>
            <button className={`${u.btn} ${u.btnSecondary}`} onClick={() => setRefund(null)} disabled={refundBusy}>
              Cancel
            </button>
            <button className={u.btn} onClick={sendRefund} disabled={refundBusy}>
              {refundBusy ? 'Refunding…' : `Refund ${refund ? formatMoney(refund.amount || '0', refund.order.currency) : ''}`}
            </button>
          </>
        }
      >
        {refund && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <p style={{ margin: 0 }}>
              Order <span className={u.mono}>{refund.order.paypal_order_id}</span>, paid{' '}
              {formatMoney(refund.order.total, refund.order.currency)}
              {refund.order.refunded ? `, already refunded ${formatMoney(refund.order.refunded, refund.order.currency)}` : ''}.
              At most {formatMoney(fromCents(remainingOf(refund.order)), refund.order.currency)} can be refunded.
            </p>
            <div className={u.field}>
              <label htmlFor="refund-amount">Amount ({refund.order.currency})</label>
              <input
                id="refund-amount"
                className={u.input}
                inputMode="decimal"
                value={refund.amount}
                onChange={(e) => setRefund((r) => (r ? { ...r, amount: e.target.value } : r))}
                disabled={refundBusy}
              />
            </div>
            <div className={u.field}>
              <label htmlFor="refund-note">Note to the buyer (optional)</label>
              <input
                id="refund-note"
                className={u.input}
                maxLength={255}
                value={refund.note}
                onChange={(e) => setRefund((r) => (r ? { ...r, note: e.target.value } : r))}
                disabled={refundBusy}
              />
            </div>
            {refund.order.dispute_id && (
              <Notice tone="info">
                This order has a dispute ({refund.order.dispute_id}). A refund does not close it by itself: afterwards, tell the
                buyer through the dispute page.
              </Notice>
            )}
            {refundMsg && !refundMsg.ok && (
              <Notice tone="bad" alert>
                {refundMsg.text}
              </Notice>
            )}
            <Notice tone="warn">The money goes back to the buyer through PayPal. It cannot be undone.</Notice>
          </div>
        )}
      </Dialog>
    </>
  );
}
