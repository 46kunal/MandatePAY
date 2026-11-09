'use client';
// OWNER: C. Merchant overview: totals, what needs attention, AI-recommended actions and recent activity.
// Everything here is computed from GET /api/cases. Nothing is invented.
import Link from 'next/link';
import { useMemo } from 'react';
import type { CaseRecord } from '@/contracts/schemas';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton, StatCard } from '../_ui/Ui';
import { ACTION, FAULT, formatMoney, formatWhen, needsReview, reasonLabel } from '../_ui/labels';
import { useCases } from '../_ui/useCases';
import u from '../_ui/ui.module.css';
import m from './merchant.module.css';

interface Activity {
  key: string;
  id: string;
  at: string;
  text: string;
}

function activity(cases: CaseRecord[]): Activity[] {
  const out: Activity[] = [];
  for (const c of cases) {
    out.push({ key: `${c.dispute_id}-open`, id: c.dispute_id, at: c.created_at, text: `Dispute opened: ${reasonLabel(c.reason)}` });
    if (c.analysis_status === 'acted') {
      out.push({ key: `${c.dispute_id}-act`, id: c.dispute_id, at: c.updated_at, text: `Action taken: ${ACTION[c.action_taken ?? ''] ?? c.action_taken ?? 'resolved'}` });
    } else if (c.verdict) {
      out.push({ key: `${c.dispute_id}-ai`, id: c.dispute_id, at: c.updated_at, text: `AI recommended: ${ACTION[c.verdict.action] ?? c.verdict.action} (${FAULT[c.verdict.fault].label})` });
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
}

export default function OverviewPage() {
  const { cases, error, reload } = useCases();

  const stats = useMemo(() => {
    if (!cases) return null;
    const resolved = cases.filter((c) => c.analysis_status === 'acted').length;
    const review = cases.filter(needsReview);
    const byAction = new Map<string, number>();
    for (const c of cases) {
      if (c.verdict && c.analysis_status !== 'acted') byAction.set(c.verdict.action, (byAction.get(c.verdict.action) ?? 0) + 1);
    }
    return { total: cases.length, pending: cases.length - resolved, resolved, review, byAction: [...byAction.entries()].sort((a, b) => b[1] - a[1]) };
  }, [cases]);

  const recent = useMemo(() => (cases ? activity(cases) : []), [cases]);

  return (
    <>
      <PageHeader title="Overview" subtitle="Disputes on your orders and what the AI recommends for each." />

      {error && (
        <Notice tone="bad" alert>
          Could not load disputes: {error}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={reload}>
            Try again
          </button>
        </Notice>
      )}

      {!cases && !error && (
        <div className={m.skelStack} aria-busy="true" aria-label="Loading overview">
          <Skeleton height={84} />
          <Skeleton height={200} />
        </div>
      )}

      {cases && cases.length === 0 && (
        <Card>
          <EmptyState title="No disputes yet" action={<Link href="/merchant/disputes" className={`${u.btn}`} style={{ textDecoration: 'none' }}>Go to disputes</Link>}>
            When a buyer disputes a payment, it appears here with an AI recommendation.
          </EmptyState>
        </Card>
      )}

      {stats && cases && cases.length > 0 && (
        <>
          <div className={u.stats}>
            <StatCard label="Total disputes" value={stats.total} />
            <StatCard label="Pending" value={stats.pending} hint="Not resolved yet" />
            <StatCard label="Need your review" value={stats.review.length} hint="Waiting for a decision" />
            <StatCard label="Resolved" value={stats.resolved} hint="Action sent to PayPal" />
          </div>

          <div className={m.grid2}>
            <Card id="attention" title="Needs your review" subtitle="A person must approve these before anything is sent." flush>
              {stats.review.length === 0 ? (
                <EmptyState title="All caught up">No disputes are waiting for a decision.</EmptyState>
              ) : (
                <ul className={m.list}>
                  {stats.review.map((c) => (
                    <li key={c.dispute_id} className={m.listItem}>
                      <Link href={`/merchant/disputes/${encodeURIComponent(c.dispute_id)}`} className={m.listLink}>
                        <span>
                          <span className={m.listTitle}>{reasonLabel(c.reason)}</span>
                          <br />
                          <span className={u.muted}>
                            {c.dispute_id}
                            {c.amount ? ` · ${formatMoney(c.amount.value, c.amount.currency)}` : ''}
                          </span>
                        </span>
                        {c.verdict && <Badge tone={FAULT[c.verdict.fault].tone}>{FAULT[c.verdict.fault].label}</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card id="actions" title="AI-recommended actions" subtitle="For disputes that are not resolved yet.">
              {stats.byAction.length === 0 ? (
                <p className={u.muted} style={{ margin: 0 }}>No open recommendations.</p>
              ) : (
                stats.byAction.map(([action, n]) => (
                  <div key={action} className={m.barRow}>
                    <span>{ACTION[action] ?? action}</span>
                    <div className={u.meter} role="img" aria-label={`${n} of ${stats.pending}`}>
                      <div className={u.meterFill} style={{ width: `${(n / Math.max(stats.pending, 1)) * 100}%` }} />
                    </div>
                    <strong>{n}</strong>
                  </div>
                ))
              )}
            </Card>
          </div>

          <Card id="recent" title="Recent dispute activity" flush>
            <ul className={m.list}>
              {recent.map((a) => (
                <li key={a.key} className={m.listItem}>
                  <Link href={`/merchant/disputes/${encodeURIComponent(a.id)}`} className={m.listLink}>
                    <span>
                      <span className={m.listTitle}>{a.text}</span>
                      <br />
                      <span className={u.muted}>{a.id}</span>
                    </span>
                    <span className={u.muted}>{formatWhen(a.at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </>
  );
}

