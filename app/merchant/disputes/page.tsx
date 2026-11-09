'use client';
// OWNER: C. Disputes list: filter, scan and open a case. "Check PayPal for new disputes" calls POST /api/disputes/poll.
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { PollDisputesResponse } from '@/contracts/schemas';
import type { z } from 'zod';
import { apiFetch } from '@/fixtures/api';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import { FAULT, STATUS, formatMoney, formatWhen, needsReview, reasonLabel } from '../../_ui/labels';
import { errMsg, useCases } from '../../_ui/useCases';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

type Poll = z.infer<typeof PollDisputesResponse>;
type Filter = 'all' | 'review' | 'ready' | 'resolved';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Needs your review' },
  { key: 'ready', label: 'Ready to review' },
  { key: 'resolved', label: 'Resolved' },
];

export default function DisputesPage() {
  const { cases, error, fixtures, reload } = useCases();
  const [filter, setFilter] = useState<Filter>('all');
  const [polling, setPolling] = useState(false);
  const [pollMsg, setPollMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [usingSample, setUsingSample] = useState(false);

  const shown = useMemo(() => {
    if (!cases) return null;
    return cases.filter((c) => {
      if (filter === 'review') return needsReview(c);
      if (filter === 'ready') return c.analysis_status === 'analysed' || c.analysis_status === 'pending';
      if (filter === 'resolved') return c.analysis_status === 'acted';
      return true;
    });
  }, [cases, filter]);

  async function poll() {
    setPolling(true);
    setPollMsg(null);
    try {
      const r = await apiFetch<Poll>('/api/disputes/poll', { method: 'POST' });
      if (r.fromFixture) setUsingSample(true);
      const { fetched, new_cases, linked } = r.data;
      setPollMsg({
        ok: true,
        text:
          new_cases > 0
            ? `Found ${new_cases} new dispute${new_cases === 1 ? '' : 's'} (${fetched} checked, ${linked} linked to an order).`
            : `Up to date: ${fetched} dispute${fetched === 1 ? '' : 's'} checked, none new.`,
      });
      reload();
    } catch (e) {
      setPollMsg({ ok: false, text: `Could not check PayPal: ${errMsg(e)}` });
    } finally {
      setPolling(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle="Each dispute is checked against the buyer's signed mandate."
        actions={
          <>
            <button className={`${u.btn} ${u.btnSecondary}`} onClick={reload} disabled={polling}>
              Refresh
            </button>
            <button className={u.btn} onClick={poll} disabled={polling}>
              {polling ? 'Checking PayPal…' : 'Check PayPal for new disputes'}
            </button>
          </>
        }
      />

      {(fixtures || usingSample) && <Notice tone="warn">Sample data: the disputes service is not available, so example disputes are shown.</Notice>}
      {pollMsg && (
        <Notice tone={pollMsg.ok ? 'good' : 'bad'} alert={!pollMsg.ok}>
          {pollMsg.text}
        </Notice>
      )}
      {error && (
        <Notice tone="bad" alert>
          Could not load disputes: {error}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={reload}>
            Try again
          </button>
        </Notice>
      )}

      {!cases && !error && (
        <div className={m.skelStack} aria-busy="true" aria-label="Loading disputes">
          <Skeleton height={40} />
          <Skeleton height={56} />
          <Skeleton height={56} />
        </div>
      )}

      {cases && cases.length === 0 && (
        <Card>
          <EmptyState title="No disputes yet">Click &ldquo;Check PayPal for new disputes&rdquo; to pull new ones in.</EmptyState>
        </Card>
      )}

      {cases && cases.length > 0 && shown && (
        <>
          <div className={u.tabs} role="tablist" aria-label="Filter disputes">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                className={`${u.tab} ${filter === f.key ? u.tabOn : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Card flush>
            {shown.length === 0 ? (
              <EmptyState title="Nothing here">No disputes match this filter.</EmptyState>
            ) : (
              <div className={u.tableWrap}>
                <table className={u.table}>
                  <thead>
                    <tr>
                      <th scope="col">Dispute</th>
                      <th scope="col" style={{ textAlign: 'right' }}>Amount</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Status</th>
                      <th scope="col">AI verdict</th>
                      <th scope="col">Confidence</th>
                      <th scope="col">Opened</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const status = STATUS[c.analysis_status];
                      const fault = c.verdict ? FAULT[c.verdict.fault] : null;
                      const pct = c.verdict ? Math.round(c.verdict.confidence * 100) : null;
                      return (
                        <tr key={c.dispute_id}>
                          <td>
                            <Link href={`/merchant/disputes/${encodeURIComponent(c.dispute_id)}`} className={u.rowLink}>
                              {c.dispute_id}
                            </Link>
                          </td>
                          <td className={u.num}>{c.amount ? formatMoney(c.amount.value, c.amount.currency) : '—'}</td>
                          <td>{reasonLabel(c.reason)}</td>
                          <td>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </td>
                          <td>{fault ? <Badge tone={fault.tone}>{fault.label}</Badge> : <span className={u.muted}>No verdict yet</span>}</td>
                          <td>
                            {pct !== null ? (
                              <div className={m.confCell} title="The AI's own estimate, not a guarantee">
                                <div className={u.meter} style={{ width: 56 }} role="img" aria-label={`Confidence ${pct} percent`}>
                                  <div className={u.meterFill} style={{ width: `${pct}%` }} />
                                </div>
                                <span>{pct}%</span>
                              </div>
                            ) : (
                              <span className={u.muted}>—</span>
                            )}
                          </td>
                          <td className={u.muted}>{formatWhen(c.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
