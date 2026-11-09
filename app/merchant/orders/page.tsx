'use client';
// OWNER: C. Orders: every order placed through MandatePay (GET /api/orders), newest first, with its payment state
// and any dispute on it.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { OrderSummary } from '@/contracts/schemas';
import { apiFetch } from '../../_ui/api';
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

export default function OrdersPage() {
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

  const abandoned = orders?.filter((o) => isAbandoned(o, now)).length ?? 0;
  const rows = orders?.filter((o) => showAbandoned || !isAbandoned(o, now)) ?? null;
  const paidCount = orders?.filter((o) => o.status === 'COMPLETED').length ?? 0;

  return (
    <>
      <PageHeader title="Orders" subtitle="Every order placed through MandatePay, newest first, with its payment and any dispute." />
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
                  <th scope="col">Payment</th>
                  <th scope="col">Placed</th>
                  <th scope="col">Captured</th>
                  <th scope="col">Receipt hash</th>
                  <th scope="col">Dispute</th>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
