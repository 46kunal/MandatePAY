'use client';
// OWNER: C. Orders. There is no "list orders" API yet, so this shows the orders attached to disputes, read from each
// dispute's detail. It says so, instead of pretending to be a full order list.
import Link from 'next/link';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import { formatDateTime, formatMoney } from '../../_ui/labels';
import { parseCase, shortHash } from '../../_ui/parse';
import { useCaseDetails, useCases } from '../../_ui/useCases';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

export default function OrdersPage() {
  const { cases, error, reload } = useCases();
  const { details, failed } = useCaseDetails(cases);
  const rows = details?.filter((d) => d.order) ?? null;

  return (
    <>
      <PageHeader title="Orders" subtitle="Orders that have a dispute, with their payment record." />
      <Notice tone="info">
        Only orders that have a dispute are listed here. A full order list will appear once an orders service is connected.
      </Notice>
      {error && (
        <Notice tone="bad" alert>
          Could not load orders: {error}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={reload}>
            Try again
          </button>
        </Notice>
      )}
      {failed > 0 && <Notice tone="warn">{failed} order{failed === 1 ? '' : 's'} could not be loaded.</Notice>}

      {!rows && !error && (
        <div className={m.skelStack} aria-busy="true" aria-label="Loading orders">
          <Skeleton height={40} />
          <Skeleton height={56} />
        </div>
      )}

      {rows && rows.length === 0 && (
        <Card>
          <EmptyState title="No orders to show">Orders appear here when one of them is disputed.</EmptyState>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card flush>
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Captured</th>
                  <th scope="col">Receipt hash</th>
                  <th scope="col">Dispute</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const o = d.order!;
                  const { guard } = parseCase(d);
                  return (
                    <tr key={o.paypal_order_id}>
                      <td className={u.mono}>{o.paypal_order_id}</td>
                      <td className={u.num}>{guard ? formatMoney(guard.total, guard.currency) : d.amount ? formatMoney(d.amount.value, d.amount.currency) : '—'}</td>
                      <td>
                        <Badge tone={o.status === 'COMPLETED' ? 'good' : 'neutral'}>{o.status === 'COMPLETED' ? 'Paid' : o.status}</Badge>
                      </td>
                      <td className={u.muted}>{formatDateTime(o.captured_at) || '—'}</td>
                      <td className={u.mono} title={o.receipt_hash ?? undefined}>
                        {shortHash(o.receipt_hash) || '—'}
                      </td>
                      <td>
                        <Link href={`/merchant/disputes/${encodeURIComponent(d.dispute_id)}`} className={u.rowLink}>
                          {d.dispute_id}
                        </Link>
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
