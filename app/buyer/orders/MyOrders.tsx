'use client';
// OWNER: C. The buyer's paid orders, with "Report a problem": the store answers here (a refund or a reply), so a
// PayPal dispute is the last resort, not the first.
import { useCallback, useEffect, useState } from 'react';
import type { MyOrder, ProblemKind } from '@/contracts/schemas';
import { apiFetch } from '../../_ui/api';
import { Dialog } from '../../_ui/Dialog';
import { formatDateTime, formatMoney } from '../../_ui/labels';
import { Badge, Card, Notice, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';

const KINDS: { value: ProblemKind; label: string }[] = [
  { value: 'agent_mistake', label: 'The agent bought something I did not ask for' },
  { value: 'not_received', label: 'It has not arrived' },
  { value: 'damaged', label: 'It arrived damaged or not as described' },
  { value: 'other', label: 'Something else' },
];

function ReportState({ o }: { o: MyOrder }) {
  const r = o.report;
  if (!r) return null;
  if (r.status === 'open') return <Badge tone="warn">Reported, waiting for the store</Badge>;
  return (
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      <Badge tone="good">{r.status === 'refunded' ? `Refunded ${r.refund ? formatMoney(r.refund.value, r.refund.currency) : ''}` : 'Store replied'}</Badge>
      {r.reply && <span className={u.muted}>“{r.reply}”</span>}
    </div>
  );
}

export function MyOrdersCard() {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<MyOrder | null>(null);
  const [kind, setKind] = useState<ProblemKind>('agent_mistake');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setOrders((await apiFetch<{ orders: MyOrder[] }>('/api/me/orders')).data.orders);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    if (!open) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/me/orders/${encodeURIComponent(open.paypal_order_id)}/report`, { body: { kind, message: text } });
      setOpen(null);
      setMsg({ ok: true, text: 'Thanks. The store has your report and will answer here, usually with a refund or a reply.' });
      void load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="orders" title="My orders" subtitle="Something wrong with an order? Report it here first. The store can refund you directly, without a PayPal dispute.">
      {!orders && !err && <Skeleton height={80} label="Loading your orders" />}
      {err && <Notice tone="bad">Could not load your orders: {err}</Notice>}
      {orders && orders.length === 0 && <p className={u.muted}>No paid orders yet.</p>}
      {orders && orders.length > 0 && (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead>
              <tr>
                <th scope="col">Items</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Paid
                </th>
                <th scope="col">When</th>
                <th scope="col">
                  <span className={u.srOnly}>Problem</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.paypal_order_id}>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {o.images.slice(0, 2).map((src) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={src} src={src} alt="" width={44} height={44} style={{ borderRadius: 6, objectFit: 'cover' }} referrerPolicy="no-referrer" />
                      ))}
                      <div>
                        {o.items.join(', ')}
                        <div className={u.muted}>Sold by {o.seller}</div>
                      </div>
                    </div>
                  </td>
                  <td className={u.num}>
                    {formatMoney(o.total.value, o.total.currency)}
                    {o.refunded && <div className={u.muted}>refunded {formatMoney(o.refunded, o.total.currency)}</div>}
                  </td>
                  <td className={u.muted}>{formatDateTime(o.paid_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {o.report && o.report.status === 'open' ? (
                      <ReportState o={o} />
                    ) : (
                      <div style={{ display: 'grid', gap: '0.5rem', justifyItems: 'end' }}>
                        <ReportState o={o} />
                        <button
                          className={`${u.btn} ${u.btnSecondary}`}
                          type="button"
                          onClick={() => {
                            setOpen(o);
                            setKind('agent_mistake');
                            setText('');
                            setMsg(null);
                          }}
                        >
                          Report a problem
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && (
        <div style={{ marginTop: '0.75rem' }}>
          <Notice tone={msg.ok ? 'good' : 'bad'} alert={!msg.ok}>
            {msg.text}
          </Notice>
        </div>
      )}

      <Dialog
        open={open !== null}
        title="Report a problem"
        onClose={() => (busy ? undefined : setOpen(null))}
        footer={
          <>
            <button className={`${u.btn} ${u.btnSecondary}`} onClick={() => setOpen(null)} disabled={busy}>
              Cancel
            </button>
            <button className={u.btn} onClick={send} disabled={busy || text.trim().length < 5}>
              {busy ? 'Sending…' : 'Send to the store'}
            </button>
          </>
        }
      >
        {open && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <p style={{ margin: 0 }}>
              {open.items.join(', ')} · {formatMoney(open.total.value, open.total.currency)}
            </p>
            <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
              <legend style={{ fontWeight: 600, marginBottom: '0.5rem' }}>What went wrong?</legend>
              {KINDS.map((k) => (
                <label key={k.value} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} disabled={busy} />
                  {k.label}
                </label>
              ))}
            </fieldset>
            <div className={u.field}>
              <label htmlFor="report-text">Tell the store in a few words</label>
              <textarea
                id="report-text"
                className={u.input}
                rows={3}
                maxLength={1000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={busy}
              />
            </div>
            {msg && !msg.ok && (
              <Notice tone="bad" alert>
                {msg.text}
              </Notice>
            )}
          </div>
        )}
      </Dialog>
    </Card>
  );
}
