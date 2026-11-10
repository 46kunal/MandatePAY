'use client';
// OWNER: C. Buyer reports: problems buyers reported on their orders before (or instead of) a PayPal dispute.
// Each one shows what the records say (was it an agent mistake?) and one answer: refund, or reply.
import { useCallback, useEffect, useState } from 'react';
import type { ProblemKind, ProblemReport } from '@/contracts/schemas';
import { useSession } from '@/lib/auth/client';
import { can } from '@/lib/auth/roles';
import { apiFetch } from '../../_ui/api';
import { Dialog } from '../../_ui/Dialog';
import { formatDateTime, formatMoney } from '../../_ui/labels';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';

const KIND: Record<ProblemKind, string> = {
  agent_mistake: 'The agent bought the wrong thing',
  not_received: 'It has not arrived',
  damaged: 'Damaged or not as described',
  other: 'Something else',
};

function OpenReport({ r, canRefund, onDone }: { r: ProblemReport; canRefund: boolean; onDone: (text: string) => void }) {
  const refundFirst = r.assessment.suggestion === 'refund' && canRefund;
  const [reply, setReply] = useState(
    r.assessment.suggestion === 'refund'
      ? 'Sorry about this. We have refunded you in full through PayPal.'
      : '',
  );
  const [confirm, setConfirm] = useState<{ key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(outcome: 'refund' | 'close', key: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/api/reports/${encodeURIComponent(r.report_id)}/resolve`, { body: { outcome, reply, idempotency_key: key } });
      setConfirm(null);
      onDone(outcome === 'refund' ? 'Refunded through PayPal and the buyer can see your reply.' : 'Reply sent. The report is closed.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const refundBtn = canRefund && (
    <button className={refundFirst ? u.btn : `${u.btn} ${u.btnSecondary}`} disabled={busy || reply.trim().length < 2} onClick={() => setConfirm({ key: crypto.randomUUID() })}>
      Refund {r.order_total ? formatMoney(r.order_total.value, r.order_total.currency) : ''}
    </button>
  );
  const closeBtn = (
    <button className={refundFirst ? `${u.btn} ${u.btnSecondary}` : u.btn} disabled={busy || reply.trim().length < 2} onClick={() => send('close', crypto.randomUUID())}>
      {busy && !confirm ? 'Sending…' : 'Reply and close'}
    </button>
  );

  return (
    <>
      <div className={u.field} style={{ marginTop: '0.9rem' }}>
        <label htmlFor={`reply-${r.report_id}`}>Your reply to the buyer</label>
        <textarea id={`reply-${r.report_id}`} className={u.input} rows={2} maxLength={1000} value={reply} onChange={(e) => setReply(e.target.value)} disabled={busy} />
      </div>
      <div className={u.row} style={{ gap: '0.75rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
        {refundFirst ? (
          <>
            {refundBtn}
            {closeBtn}
          </>
        ) : (
          <>
            {closeBtn}
            {refundBtn}
          </>
        )}
      </div>
      {!canRefund && <p className={u.muted} style={{ margin: '0.5rem 0 0' }}>Only an owner or admin can refund.</p>}
      {err && !confirm && (
        <div style={{ marginTop: '0.6rem' }}>
          <Notice tone="bad" alert>
            {err}
          </Notice>
        </div>
      )}
      <Dialog
        open={confirm !== null}
        title="Refund through PayPal"
        onClose={() => (busy ? undefined : setConfirm(null))}
        footer={
          <>
            <button className={`${u.btn} ${u.btnSecondary}`} onClick={() => setConfirm(null)} disabled={busy}>
              Cancel
            </button>
            <button className={u.btn} onClick={() => confirm && send('refund', confirm.key)} disabled={busy}>
              {busy ? 'Refunding…' : 'Refund now'}
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <p style={{ margin: 0 }}>
            Everything still refundable on order <span className={u.mono}>{r.paypal_order_id}</span> goes back to {r.buyer_email}, and they see your reply.
          </p>
          {err && (
            <Notice tone="bad" alert>
              {err}
            </Notice>
          )}
          <Notice tone="warn">The money goes back through PayPal. It cannot be undone.</Notice>
        </div>
      </Dialog>
    </>
  );
}

export default function ReportsPage() {
  const { data: session } = useSession();
  const canRefund = can((session?.user as { role?: string } | undefined)?.role, 'orders:refund');
  const [reports, setReports] = useState<ProblemReport[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReports((await apiFetch<{ reports: ProblemReport[] }>('/api/reports')).data.reports);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const open = reports?.filter((r) => r.status === 'open') ?? [];
  const answered = reports?.filter((r) => r.status !== 'open') ?? [];

  return (
    <>
      <PageHeader title="Buyer reports" subtitle="Problems buyers reported before opening a PayPal dispute. Answer them here and most never become disputes." />
      {err && <Notice tone="bad">Could not load reports: {err}</Notice>}
      {done && <Notice tone="good">{done}</Notice>}
      {!reports && !err && <Skeleton height={160} label="Loading reports" />}
      {reports && reports.length === 0 && (
        <Card>
          <EmptyState title="No reports yet">When a buyer reports a problem with an order, it appears here.</EmptyState>
        </Card>
      )}

      <div style={{ display: 'grid', gap: '1rem' }}>
        {open.map((r) => (
          <Card key={r.report_id} id={r.report_id} title={KIND[r.kind]} subtitle={`${r.buyer_email ?? 'Buyer'} · ${formatDateTime(r.created_at)}`}>
            <p style={{ margin: 0 }}>
              {r.items?.join(', ')} {r.order_total && `· ${formatMoney(r.order_total.value, r.order_total.currency)}`}{' '}
              <span className={u.muted}>· order {r.paypal_order_id}</span>
            </p>
            <blockquote style={{ margin: '0.6rem 0 0', paddingLeft: '0.75rem', borderLeft: '3px solid var(--border, #ccc)' }}>
              {r.message}
            </blockquote>
            <div style={{ marginTop: '0.9rem' }}>
              <Notice tone={r.assessment.agent_mistake ? 'warn' : 'info'}>
                <strong>{r.assessment.agent_mistake ? 'Agent mistake: refund recommended. ' : 'What the records say: '}</strong>
                {r.assessment.summary}
              </Notice>
            </div>
            <OpenReport
              r={r}
              canRefund={canRefund}
              onDone={(text) => {
                setDone(text);
                void load();
              }}
            />
          </Card>
        ))}

        {answered.length > 0 && (
          <Card title="Answered" flush>
            <div className={u.tableWrap}>
              <table className={u.table}>
                <thead>
                  <tr>
                    <th scope="col">Problem</th>
                    <th scope="col">Buyer</th>
                    <th scope="col">Answer</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {answered.map((r) => (
                    <tr key={r.report_id}>
                      <td>
                        {KIND[r.kind]}
                        <div className={u.muted}>{r.items?.join(', ')}</div>
                      </td>
                      <td>{r.buyer_email}</td>
                      <td>
                        <Badge tone="good">{r.status === 'refunded' ? `Refunded ${r.refund ? formatMoney(r.refund.value, r.refund.currency) : ''}` : 'Replied'}</Badge>
                        {r.reply && <div className={u.muted}>“{r.reply}”</div>}
                      </td>
                      <td className={u.muted}>{formatDateTime(r.resolved_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
