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
  const [onlyPaid, setOnlyPaid] = useState(false);

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

  const rows = orders?.filter((o) => !onlyPaid || o.status === 'COMPLETED') ?? null;
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
          title={`${orders.length} order${orders.length === 1 ? '' : 's'} · ${paidCount} paid`}
          actions={
            <label className={u.muted} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={onlyPaid} onChange={(e) => setOnlyPaid(e.target.checked)} />
              Paid only
            </label>
          }
        >
          <div className={u.tableWrap}>
            <table className={u.table}>
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
                  const p = paymentLabel(o.status);
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
