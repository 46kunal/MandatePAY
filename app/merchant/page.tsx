'use client';
// OWNER: C. Store overview. It leads with what needs a person (disputes due, buyer reports), then the numbers, the
// dispute pipeline and recent activity. Everything is computed from stored records; nothing is invented.
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CaseRecord, ProblemReport, ResultsResponse } from '@/contracts/schemas';
import { apiFetch } from '../_ui/api';
import { Icon, type IconName } from '../_ui/Icons';
import { ACTION, FAULT, dueLabel, formatMoney, formatWhen, reasonLabel } from '../_ui/labels';
import { Badge, Notice, Skeleton } from '../_ui/Ui';
import { Tween } from '../_ui/Tween';
import { useCases } from '../_ui/useCases';
import u from '../_ui/ui.module.css';
import o from './overview.module.css';

function today(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const isWaitingOnStore = (c: CaseRecord) => c.analysis_status !== 'acted' && c.status !== 'RESOLVED' && (c.response_due?.party === 'seller' || c.status === 'WAITING_FOR_SELLER_RESPONSE');

type Bucket = { key: string; label: string; color: string; n: number };

function pipeline(cases: CaseRecord[]): Bucket[] {
  const mine = cases.filter(isWaitingOnStore).length;
  const resolved = cases.filter((c) => c.status === 'RESOLVED').length;
  const review = cases.filter((c) => c.status === 'UNDER_REVIEW' || c.status === 'UNDER_PAYPAL_REVIEW').length;
  const buyer = cases.filter((c) => c.status !== 'RESOLVED' && !isWaitingOnStore(c) && c.status !== 'UNDER_REVIEW' && c.status !== 'UNDER_PAYPAL_REVIEW').length;
  return [
    { key: 'store', label: 'Waiting for you', color: 'var(--stamp)', n: mine },
    { key: 'buyer', label: 'Waiting for the buyer', color: 'var(--text-2)', n: buyer },
    { key: 'review', label: 'Under PayPal review', color: 'var(--muted-2)', n: review },
    { key: 'done', label: 'Resolved', color: 'var(--border)', n: resolved },
  ];
}

function hours(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(1)} days`;
}

export default function OverviewPage() {
  const { cases, error, reload } = useCases();
  // The date depends on the visitor's clock and locale, so it is filled in only in the browser (no server mismatch).
  const [date, setDate] = useState('');
  useEffect(() => setDate(today()), []);
  const [reports, setReports] = useState<ProblemReport[] | null>(null);
  const [results, setResults] = useState<ResultsResponse | null>(null);

  useEffect(() => {
    apiFetch<{ reports: ProblemReport[] }>('/api/reports')
      .then((r) => setReports(r.data.reports))
      .catch(() => setReports([]));
    apiFetch<ResultsResponse>('/api/results')
      .then((r) => setResults(r.data))
      .catch(() => setResults(null));
  }, []);

  const todo = useMemo(() => {
    const items: { key: string; href: string; icon: IconName; tone: string; title: string; meta: string; chip?: { text: string; tone: 'good' | 'bad' | 'warn' | 'info' | 'neutral' }; sort: number }[] = [];
    for (const c of cases ?? []) {
      if (!isWaitingOnStore(c)) continue;
      const due = dueLabel(c.response_due);
      items.push({
        key: c.dispute_id,
        href: `/merchant/disputes/${encodeURIComponent(c.dispute_id)}`,
        icon: 'shield',
        tone: o.tNeutral,
        title: `${reasonLabel(c.reason)}${c.amount ? ` · ${formatMoney(c.amount.value, c.amount.currency)}` : ''}`,
        meta: `${c.dispute_id} · ${c.verdict ? `AI: ${ACTION[c.verdict.action] ?? c.verdict.action}` : 'AI has not looked yet'}`,
        chip: due ? { text: due.text, tone: due.tone } : undefined,
        sort: c.response_due ? Date.parse(c.response_due.at) : Number.MAX_SAFE_INTEGER - 1,
      });
    }
    for (const r of reports ?? []) {
      if (r.status !== 'open') continue;
      items.push({
        key: r.report_id,
        href: '/merchant/reports',
        icon: 'inbox',
        tone: o.tNeutral,
        title: `Buyer reported a problem${r.items?.length ? `: ${r.items.join(', ')}` : ''}`,
        meta: `${r.buyer_email ?? 'A buyer'} · ${formatWhen(r.created_at)}`,
        chip: r.assessment.agent_mistake ? { text: 'Refund recommended', tone: 'warn' } : undefined,
        sort: Date.parse(r.created_at),
      });
    }
    return items.sort((a, b) => a.sort - b.sort);
  }, [cases, reports]);

  const buckets = useMemo(() => (cases ? pipeline(cases) : []), [cases]);
  const total = buckets.reduce((n, b) => n + b.n, 0);

  const recent = useMemo(() => {
    const out: { key: string; id: string; at: string; text: string }[] = [];
    for (const c of cases ?? []) {
      out.push({ key: `${c.dispute_id}-open`, id: c.dispute_id, at: c.created_at, text: `Dispute opened: ${reasonLabel(c.reason)}` });
      if (c.analysis_status === 'acted') out.push({ key: `${c.dispute_id}-act`, id: c.dispute_id, at: c.updated_at, text: `You responded: ${ACTION[c.action_taken ?? ''] ?? c.action_taken ?? 'done'}` });
      else if (c.verdict) out.push({ key: `${c.dispute_id}-ai`, id: c.dispute_id, at: c.updated_at, text: `AI view: ${FAULT[c.verdict.fault].label}` });
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 6);
  }, [cases]);

  const loading = !cases && !error;

  return (
    <>
      <div className={o.head}>
        <h1>Overview</h1>
        <p>{date || ' '}</p>
      </div>

      {error && (
        <Notice tone="bad" alert>
          Could not load disputes: {error}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={reload} style={{ marginLeft: 8 }}>
            Try again
          </button>
        </Notice>
      )}

      <div className={o.kpis}>
        <div className={o.kpi}>
          <div className={o.kpiLabel}>Needs you</div>
          <div className={o.kpiValue}>{loading ? '–' : <Tween value={todo.length} />}</div>
          <div className={o.kpiHint}>Disputes and buyer reports</div>
        </div>
        <div className={o.kpi}>
          <div className={o.kpiLabel}>Open disputes</div>
          <div className={o.kpiValue}>{loading ? '–' : <Tween value={total - (buckets.find((b) => b.key === 'done')?.n ?? 0)} />}</div>
          <div className={o.kpiHint}>{results ? `${results.disputes.total} received in total` : 'Not resolved yet'}</div>
        </div>
        <div className={o.kpi}>
          <div className={o.kpiLabel}>Typical response time</div>
          <div className={o.kpiValue}>{results?.speed.median_minutes_to_response != null ? hours(results.speed.median_minutes_to_response) : '–'}</div>
          <div className={o.kpiHint}>From a dispute arriving to your response</div>
        </div>
        <div className={o.kpi}>
          <div className={o.kpiLabel}>AI accuracy</div>
          <div className={o.kpiValue}>{results?.eval ? <Tween value={Math.round(results.eval.overall * 100)} suffix="%" /> : '–'}</div>
          <div className={o.kpiHint}>{results?.eval ? `On ${results.eval.cases} labelled disputes` : 'Run the test set'}</div>
        </div>
      </div>

      <div className={o.cols}>
        <div>
          <section className={`${o.panel}`} aria-labelledby="todo-h">
            <div className={o.panelHead}>
              <h2 id="todo-h">Needs your attention</h2>
              <span>{todo.length === 0 ? 'Nothing waiting' : `${todo.length} item${todo.length === 1 ? '' : 's'}`}</span>
            </div>
            {loading ? (
              <div style={{ padding: '1rem 1.25rem' }}>
                <Skeleton height={64} label="Loading" />
              </div>
            ) : todo.length === 0 ? (
              <div className={o.caught}>
                <span className={o.caughtIcon}>
                  <Icon name="check" size={22} />
                </span>
                <b>You are all caught up</b>
                <span>New disputes and buyer reports will appear here the moment they arrive.</span>
              </div>
            ) : (
              <ul className={o.todo}>
                {todo.slice(0, 8).map((t, idx) => (
                  <li key={t.key} className={u.enter} style={{ ['--i' as string]: Math.min(idx, 5) }}>
                    <Link href={t.href} className={o.todoItem}>
                      <span className={`${o.todoIcon} ${t.tone}`}>
                        <Icon name={t.icon} />
                      </span>
                      <span className={o.todoBody}>
                        <b>{t.title}</b>
                        <span>{t.meta}</span>
                      </span>
                      {t.chip && <Badge tone={t.chip.tone}>{t.chip.text}</Badge>}
                      <Icon name="arrow" size={16} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${o.panel}`} aria-labelledby="pipe-h">
            <div className={o.panelHead}>
              <h2 id="pipe-h">Dispute pipeline</h2>
              <Link href="/merchant/disputes" style={{ fontSize: '0.88rem', color: 'var(--text-2)', textDecoration: 'none' }}>
                All disputes
              </Link>
            </div>
            <div className={o.pipe}>
              {total === 0 ? (
                <span style={{ color: 'var(--muted)' }}>No disputes yet.</span>
              ) : (
                <>
                  <div className={o.bar} role="img" aria-label={buckets.map((b) => `${b.label}: ${b.n}`).join(', ')}>
                    {buckets
                      .filter((b) => b.n > 0)
                      .map((b) => (
                        <div key={b.key} className={o.seg} style={{ flexGrow: b.n, background: b.color }} />
                      ))}
                  </div>
                  <div className={o.legend}>
                    {buckets.map((b) => (
                      <div key={b.key} className={o.legendRow}>
                        <span className={o.dot} style={{ background: b.color }} />
                        {b.label}
                        <b>{b.n}</b>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <div>
          <section className={`${o.panel}`} aria-labelledby="act-h">
            <div className={o.panelHead}>
              <h2 id="act-h">Recent activity</h2>
            </div>
            {recent.length === 0 ? (
              <div className={o.caught} style={{ padding: '1.6rem 1rem' }}>
                <span>Activity shows up here once disputes arrive.</span>
              </div>
            ) : (
              <ul className={o.timeline}>
                {recent.map((a, idx) => (
                  <li key={a.key} className={`${o.tl} ${u.enter}`} style={{ ['--i' as string]: Math.min(idx, 5) }}>
                    <span className={o.tlDot} />
                    <div>
                      <Link href={`/merchant/disputes/${encodeURIComponent(a.id)}`}>{a.text}</Link>
                      <span>
                        {a.id} · {formatWhen(a.at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
