'use client';
// OWNER: C. Results: what MandatePay has done, from the stored records (GET /api/results). The only estimate,
// minutes saved, says what it assumes.
import { useEffect, useState } from 'react';
import type { ResultsResponse } from '@/contracts/schemas';
import { apiFetch } from '../../_ui/api';
import { formatDateTime, formatDay, formatMoney } from '../../_ui/labels';
import { Card, Notice, PageHeader, Skeleton, StatCard } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : 'n/a');
const ratio = (x: number) => `${Math.round(x * 100)}%`;

function hours(min: number): string {
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(1)} days`;
}

function Bar({ label, n, of }: { label: string; n: number; of: number }) {
  return (
    <div className={m.barRow}>
      <span>{label}</span>
      <div className={u.meter} role="img" aria-label={`${n} of ${of}`}>
        <div className={u.meterFill} style={{ width: `${of > 0 ? (n / of) * 100 : 0}%` }} />
      </div>
      <strong>{n}</strong>
    </div>
  );
}

export default function ResultsPage() {
  const [r, setR] = useState<ResultsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<ResultsResponse>('/api/results')
      .then((x) => setR(x.data))
      .catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <>
      <PageHeader title="Results" subtitle="What MandatePay has done so far, counted from your records." />
      {err && <Notice tone="bad">Could not load results: {err}</Notice>}
      {!r && !err && <Skeleton height={200} label="Loading results" />}
      {r && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div className={u.stats}>
            <StatCard label="Disputes handled" value={r.disputes.analysed} hint={`of ${r.disputes.total} received, analysed by the AI`} />
            <StatCard
              label="Time saved (estimate)"
              value={hours(r.speed.est_minutes_saved)}
              hint={`${r.speed.manual_minutes_per_dispute} min per dispute done by hand`}
            />
            <StatCard
              label="People kept the AI's advice"
              value={pct(r.people.followed_ai, r.people.responses)}
              hint={`${r.people.followed_ai} of ${r.people.responses} responses sent`}
            />
            <StatCard
              label="AI accuracy (test set)"
              value={r.eval ? ratio(r.eval.overall) : 'n/a'}
              hint={r.eval ? `${r.eval.cases} labelled cases` : 'Run npm run eval'}
            />
          </div>

          <div className={m.grid2}>
            <Card title="Disputes" subtitle="Every PayPal dispute on an order paid through MandatePay.">
              <Bar label="Received" n={r.disputes.total} of={r.disputes.total} />
              <Bar label="Analysed by the AI" n={r.disputes.analysed} of={r.disputes.total} />
              <Bar label="Response sent to PayPal" n={r.disputes.responded} of={r.disputes.total} />
              <Bar label="Closed by PayPal" n={r.disputes.resolved} of={r.disputes.total} />
              <p className={u.muted} style={{ margin: '0.6rem 0 0' }}>
                Of the closed ones: store won {r.disputes.store_won}, buyer won {r.disputes.buyer_won}.
                {r.speed.median_minutes_to_response !== null && ` Typical time from a dispute arriving to a response: ${hours(r.speed.median_minutes_to_response)}.`}
              </p>
            </Card>

            <Card title="People and the AI" subtitle="Every response a person sent through MandatePay.">
              <Bar label="Sent what the AI advised" n={r.people.followed_ai} of={r.people.responses} />
              <Bar label="Chose something else" n={r.people.changed_ai} of={r.people.responses} />
              <Bar label="AI asked a person, who approved" n={r.people.approved_by_person} of={r.people.responses} />
              <p className={u.muted} style={{ margin: '0.6rem 0 0' }}>
                Nothing is sent to PayPal without a person clicking send.
              </p>
            </Card>

            <Card title="The mandate guard" subtitle="Every cart the shopping agent built, checked against what the buyer signed.">
              <Bar label="Allowed" n={r.guard.allowed} of={r.guard.carts_checked} />
              <Bar label="Buyer had to approve" n={r.guard.needed_approval} of={r.guard.carts_checked} />
              <Bar label="Blocked" n={r.guard.blocked} of={r.guard.carts_checked} />
              <p className={u.muted} style={{ margin: '0.6rem 0 0' }}>
                {r.guard.carts_checked} carts checked, {r.guard.orders_paid} orders paid.
                {r.guard.blocked_value && ` The guard stopped ${formatMoney(r.guard.blocked_value.value, r.guard.blocked_value.currency)} from being spent outside a mandate.`}
              </p>
            </Card>

            <Card title="Fixed before a dispute" subtitle="Problems buyers reported to the store instead of PayPal.">
              <Bar label="Refunded" n={r.reports.refunded} of={r.reports.total} />
              <Bar label="Replied" n={r.reports.closed} of={r.reports.total} />
              <Bar label="Waiting for an answer" n={r.reports.open} of={r.reports.total} />
              <p className={u.muted} style={{ margin: '0.6rem 0 0' }}>
                {r.reports.total} reports, {r.reports.agent_mistakes} of them clear agent mistakes.
                {r.refunds.total && ` All refunds: ${r.refunds.count}, ${formatMoney(r.refunds.total.value, r.refunds.total.currency)}.`}
              </p>
            </Card>
          </div>

          {r.eval && (
            <Card title="AI accuracy on the test set" subtitle={`${r.eval.cases} labelled disputes, last run ${formatDay(r.eval.run_at)} with ${r.eval.provider}.`}>
              <Bar label="Who is at fault" n={Math.round(r.eval.fault * 100)} of={100} />
              <Bar label="Right action" n={Math.round(r.eval.action * 100)} of={100} />
              <Bar label="Asks a person when it should" n={Math.round(r.eval.needs_human * 100)} of={100} />
              <Bar label="Everything right" n={Math.round(r.eval.overall * 100)} of={100} />
              <p className={u.muted} style={{ margin: '0.6rem 0 0' }}>Figures are percentages. Code rules check every AI answer before you see it.</p>
            </Card>
          )}
          <p className={u.muted} style={{ margin: 0 }}>Counted {formatDateTime(r.generated_at)}.</p>
        </div>
      )}
    </>
  );
}
