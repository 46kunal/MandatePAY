'use client';
// OWNER: C. Disputes list: filter, scan and open a case. "Check PayPal for new disputes" calls POST /api/disputes/poll.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CaseRecord, PollDisputesResponse } from '@/contracts/schemas';
import type { z } from 'zod';
import { apiFetch } from '@/app/_ui/api';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import { FAULT, STATUS, formatMoney, formatWhen, needsReview, reasonLabel, dueLabel } from '../../_ui/labels';
import { errMsg, useCases } from '../../_ui/useCases';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

type Poll = z.infer<typeof PollDisputesResponse>;
type Filter = 'all' | 'review' | 'ready' | 'resolved' | 'dismissed';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'review', label: 'Needs your review' },
  { key: 'ready', label: 'Ready to review' },
  { key: 'resolved', label: 'Responded' },
  { key: 'dismissed', label: 'Dismissed' },
];

export default function DisputesPage() {
  const { cases, error, reload } = useCases();
  const [filter, setFilter] = useState<Filter>('all');
  const [polling, setPolling] = useState(false);
  const [pollMsg, setPollMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [byId, setById] = useState('');

  // Disputes a person hid (old, test or outside ones). They stay stored; Restore brings one back.
  const [dismissed, setDismissed] = useState<CaseRecord[]>([]);
  const loadDismissed = useCallback(async () => {
    try {
      setDismissed((await apiFetch<CaseRecord[]>('/api/cases?dismissed=1')).data);
    } catch {
      setDismissed([]);
    }
  }, []);
  useEffect(() => {
    void loadDismissed();
  }, [loadDismissed]);

  async function setHidden(id: string, hide: boolean) {
    setPollMsg(null);
    try {
      await apiFetch(`/api/cases/${encodeURIComponent(id)}/dismiss`, { body: { dismissed: hide } });
      reload();
      void loadDismissed();
      setPollMsg({ ok: true, text: hide ? `${id} is hidden. Find it under Dismissed if you need it back.` : `${id} is back in the list.` });
    } catch (e) {
      setPollMsg({ ok: false, text: errMsg(e) });
    }
  }

  // New disputes arrive by PayPal notification, and this page also asks PayPal itself every minute while it is open,
  // so nobody has to click anything. (PayPal's list can lag a few minutes; the by-id box below covers that.)
  const [feed, setFeed] = useState<{ last: string | null; refused: string | null; configured: boolean } | null>(null);
  useEffect(() => {
    let stop = false;
    async function quiet() {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await apiFetch<Poll>('/api/disputes/poll', { method: 'POST' });
        if (!stop && r.data.new_cases > 0) {
          reload();
          setPollMsg({ ok: true, text: `Found ${r.data.new_cases} new dispute${r.data.new_cases === 1 ? '' : 's'}.` });
        }
      } catch {
        /* the Check button shows errors; a background check stays quiet */
      }
      try {
        const st = await apiFetch<{ webhooks_configured: boolean; last_webhook_at: string | null; last_webhook_rejected?: { error: string } | null }>('/api/status');
        if (!stop) setFeed({ last: st.data.last_webhook_at, refused: st.data.last_webhook_rejected?.error ?? null, configured: st.data.webhooks_configured });
      } catch {
        /* status is only a hint */
      }
    }
    void quiet();
    const t = setInterval(quiet, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    if (!cases) return null;
    if (filter === 'dismissed') return dismissed;
    return cases.filter((c) => {
      if (filter === 'review') return needsReview(c);
      if (filter === 'ready') return c.analysis_status === 'analysed' || c.analysis_status === 'pending';
      if (filter === 'resolved') return c.analysis_status === 'acted';
      return true;
    });
  }, [cases, dismissed, filter]);

  async function poll(disputeId?: string) {
    setPolling(true);
    setPollMsg(null);
    try {
      const r = await apiFetch<Poll>('/api/disputes/poll', {
        method: 'POST',
        ...(disputeId ? { body: { dispute_id: disputeId } } : {}),
      });
      if (disputeId) {
        setPollMsg({
          ok: true,
          text: r.data.new_cases
            ? `Added ${disputeId}${r.data.linked ? ', linked to its order' : ', but it is not linked to an order placed here'}.`
            : `${disputeId} is already up to date.`,
        });
        setById('');
        reload();
        return;
      }
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
            <button className={u.btn} onClick={() => poll()} disabled={polling}>
              {polling ? 'Checking PayPal…' : 'Check PayPal for new disputes'}
            </button>
          </>
        }
      />

      <form
        className={u.row}
        style={{ marginBottom: '0.9rem', gap: '0.5rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (byId.trim()) void poll(byId.trim().toUpperCase());
        }}
      >
        <label htmlFor="dispute-id" className={u.muted}>
          New dispute not showing yet? PayPal&apos;s list can lag. Fetch it by its ID:
        </label>
        <input
          id="dispute-id"
          value={byId}
          onChange={(e) => setById(e.target.value)}
          placeholder="PP-R-ABC-12345678"
          style={{ width: '14rem' }}
          disabled={polling}
        />
        <button className={`${u.btn} ${u.btnSecondary}`} type="submit" disabled={polling || !byId.trim()}>
          Fetch
        </button>
      </form>

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

      {feed && (
        <p className={u.muted} style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }} role="status">
          {feed.refused
            ? `PayPal is sending dispute notifications but this store refused them (${feed.refused}). The page checks PayPal itself every minute meanwhile.`
            : feed.last
              ? `Live: PayPal notified this store ${formatWhen(feed.last)}. This page also checks PayPal every minute.`
              : feed.configured
                ? 'No PayPal notification has arrived yet. This page checks PayPal itself every minute, and PayPal can take a few minutes to list a new dispute.'
                : 'Notifications are not set up, so this page checks PayPal itself every minute.'}
        </p>
      )}

      {cases && cases.length === 0 && dismissed.length === 0 && (
        <Card>
          <EmptyState title="No disputes yet">Click &ldquo;Check PayPal for new disputes&rdquo; to pull new ones in.</EmptyState>
        </Card>
      )}

      {cases && (cases.length > 0 || dismissed.length > 0) && shown && (
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
              <EmptyState title="Nothing here">{filter === 'dismissed' ? 'Nothing is dismissed.' : 'No disputes match this filter.'}</EmptyState>
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
                      <th scope="col">Deadline</th>
                      <th scope="col">Opened</th>
                      <th scope="col">
                        <span className={u.srOnly}>Hide or restore</span>
                      </th>
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
                          <td>
                            {(() => {
                              const due = c.analysis_status === 'acted' ? null : dueLabel(c.response_due);
                              return due ? <Badge tone={due.tone}>{due.text}</Badge> : <span className={u.muted}>—</span>;
                            })()}
                          </td>
                          <td className={`${u.muted} ${u.nowrap}`}>{formatWhen(c.created_at)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className={u.linkButton}
                              onClick={() => setHidden(c.dispute_id, filter !== 'dismissed')}
                              title={filter === 'dismissed' ? 'Show this dispute in the list again' : 'Hide this dispute from the lists. Nothing is sent to PayPal.'}
                            >
                              {filter === 'dismissed' ? 'Restore' : 'Dismiss'}
                            </button>
                          </td>
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
