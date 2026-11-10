'use client';
// OWNER: C. Evidence reports. Lists a printable evidence summary per dispute. There is no PDF generator connected yet,
// so each summary opens as a page you can print or save as a PDF from the browser.
import Link from 'next/link';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import { FAULT, formatMoney, formatWhen, reasonLabel } from '../../_ui/labels';
import { useCases } from '../../_ui/useCases';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

export default function EvidenceListPage() {
  const { cases, error, reload } = useCases();

  return (
    <>
      <PageHeader title="Evidence reports" subtitle="A summary of the mandate, cart, payment and AI assessment for each dispute." />
      <Notice tone="info">
        Open a summary to read the evidence for a dispute. Every dispute also has a PDF evidence pack you can download from its page and send to PayPal.
      </Notice>
      {error && (
        <Notice tone="bad" alert>
          Could not load disputes: {error}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={reload}>
            Try again
          </button>
        </Notice>
      )}

      {!cases && !error && (
        <div className={m.skelStack} aria-busy="true" aria-label="Loading evidence reports">
          <Skeleton height={40} />
          <Skeleton height={56} />
        </div>
      )}

      {cases && cases.length === 0 && (
        <Card>
          <EmptyState title="No evidence reports yet">A summary is available as soon as a dispute is opened.</EmptyState>
        </Card>
      )}

      {cases && cases.length > 0 && (
        <Card flush>
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead>
                <tr>
                  <th scope="col">Dispute</th>
                  <th scope="col">Reason</th>
                  <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                  <th scope="col">AI verdict</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Report</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.dispute_id}>
                    <td>{c.dispute_id}</td>
                    <td>{reasonLabel(c.reason)}</td>
                    <td className={u.num}>{c.amount ? formatMoney(c.amount.value, c.amount.currency) : '—'}</td>
                    <td>{c.verdict ? <Badge tone={FAULT[c.verdict.fault].tone}>{FAULT[c.verdict.fault].label}</Badge> : <span className={u.muted}>No verdict yet</span>}</td>
                    <td className={u.muted}>{formatWhen(c.created_at)}</td>
                    <td>
                      <Link href={`/merchant/evidence/${encodeURIComponent(c.dispute_id)}`} className={u.rowLink}>
                        View summary
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
