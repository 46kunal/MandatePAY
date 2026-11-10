'use client';
// OWNER: C. Case detail. Shows what happened, why the AI recommends what it does, and the human approval step.
// Actions call POST /api/cases/:id/act (A). The analyst runs through POST /api/cases/:id/analyse (B).
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ActionType, OfferType, type CaseRecord, type Verdict } from '@/contracts/schemas';
import { ApiClientError, apiFetch } from '@/app/_ui/api';
import type { CaseDetail } from '@/lib/paypal/cases';
import { Dialog } from '../../../_ui/Dialog';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../../_ui/Ui';
import {
  ACTION,
  ACTION_LIST,
  FAULT,
  OFFER_LABEL,
  OUTCOME,
  STATUS,
  formatDateTime,
  formatMoney,
  reasonLabel,
} from '../../../_ui/labels';
import { parseCase } from '../../../_ui/parse';
import { errMsg } from '../../../_ui/useCases';
import { EvidenceSummary } from '../../_components/EvidenceSummary';
import { MandateVsCart } from '../../_components/MandateVsCart';
import u from '../../../_ui/ui.module.css';
import m from '../../merchant.module.css';

type Override = { action: ActionType; offer_type?: OfferType; offer_amount?: string };
interface Pending {
  /** What is about to be sent, shown in the confirmation dialog. */
  action: ActionType;
  offerType?: OfferType;
  amount?: string;
  overriding: boolean;
  override?: Override;
}

function describe(action: ActionType, offerType?: OfferType): string {
  const a = ACTION[action] ?? action;
  return action === 'MAKE_OFFER' && offerType ? `${a}: ${OFFER_LABEL[offerType] ?? offerType}` : a;
}

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loadError, setLoadError] = useState<{ notFound: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'act' | 'analyse' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [form, setForm] = useState<'edit' | 'override' | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const r = await apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`, { signal });
        if (!r.data) throw new ApiClientError(404, { error: 'case_not_found' });
        setDetail(r.data);
      } catch (e) {
        if (signal?.aborted) return;
        setLoadError({ notFound: e instanceof ApiClientError && e.status === 404, text: errMsg(e) });
      }
    },
    [id],
  );

  useEffect(() => {
    const ctl = new AbortController();
    void load(ctl.signal);
    return () => ctl.abort();
  }, [load]);

  async function send(p: Pending) {
    setBusy('act');
    setNotice(null);
    try {
      const r = await apiFetch<CaseRecord>(`/api/cases/${encodeURIComponent(id)}/act`, {
        body: { human_approved: true, ...(p.override ? { override: p.override } : {}) },
      });
      setDetail((cur) => (cur ? { ...cur, ...r.data } : cur));
      setPending(null);
      setForm(null);
      setNotice({ ok: true, text: `Resolved: ${describe(p.action, p.offerType)} was sent to PayPal.` });
    } catch (e) {
      setPending(null);
      let text = errMsg(e);
      if (e instanceof ApiClientError) {
        if (e.body.error === 'already_acted') text = 'This case was already handled.';
        else if (e.body.error === 'human_approval_required') text = 'A person must approve this action first.';
        else if (e.body.error === 'paypal_not_configured') text = 'PayPal is not configured on the server, so the action could not be sent.';
      }
      setNotice({ ok: false, text });
      // 409: someone else already handled it, so what we are showing is stale. Reload the real state.
      if (e instanceof ApiClientError && e.status === 409) {
        setForm(null);
        void load();
      }
    } finally {
      setBusy(null);
    }
  }

  async function analyse() {
    setBusy('analyse');
    setNotice(null);
    try {
      const r = await apiFetch<Verdict>(`/api/cases/${encodeURIComponent(id)}/analyse`, { method: 'POST' });
      setDetail((cur) =>
        cur ? { ...cur, verdict: r.data, analysis_status: r.data.needs_human ? 'awaiting_human' : 'analysed' } : cur,
      );
    } catch (e) {
      setNotice({ ok: false, text: `Analysis failed: ${errMsg(e)}` });
    } finally {
      setBusy(null);
    }
  }

  const back = (
    <Link href="/merchant/disputes" className={u.crumb}>
      ← All disputes
    </Link>
  );

  if (loadError) {
    return (
      <>
        {back}
        <Card>
          <EmptyState
            title={loadError.notFound ? 'Dispute not found' : 'Could not load this dispute'}
            action={
              !loadError.notFound ? (
                <button className={u.btn} onClick={() => load()}>
                  Try again
                </button>
              ) : undefined
            }
          >
            {loadError.notFound ? `There is no dispute called ${id}.` : loadError.text}
          </EmptyState>
        </Card>
      </>
    );
  }

  if (!detail) {
    return (
      <>
        {back}
        <div className={m.skelStack} aria-busy="true" aria-label="Loading dispute">
          <Skeleton height={28} />
          <Skeleton height={150} />
          <Skeleton height={220} />
        </div>
      </>
    );
  }

  const status = STATUS[detail.analysis_status];
  const acted = detail.analysis_status === 'acted';
  const verdict = detail.verdict;
  const fault = verdict ? FAULT[verdict.fault] : null;
  const outcome = verdict ? OUTCOME[verdict.fault] : null;
  const { constraints, cart, guard } = parseCase(detail);
  const cur = detail.amount?.currency ?? 'USD';
  const pct = verdict ? Math.round(verdict.confidence * 100) : 0;

  const timeline: { key: string; title: string; text?: string; at?: string | null; kind?: 'dispute' | 'done' }[] = [];
  if (detail.mandate) {
    timeline.push({
      key: 'mandate',
      title: 'Buyer signed a mandate',
      text: constraints?.request_text ? `“${constraints.request_text}”` : undefined,
    });
  }
  if (detail.cart) {
    const g = guard?.verdict;
    timeline.push({
      key: 'cart',
      title: g === 'allow' ? 'Cart passed the mandate check' : g === 'escalate' ? 'Cart needed buyer approval' : 'Cart was checked',
      text: `Approved by the ${detail.cart.approved_by ?? 'agent'}.`,
    });
  }
  if (detail.order) {
    timeline.push({ key: 'paid', title: 'Payment captured', text: `Order ${detail.order.paypal_order_id}`, at: detail.order.captured_at });
  }
  timeline.push({ key: 'dispute', title: 'Dispute opened', text: reasonLabel(detail.reason), at: detail.created_at, kind: 'dispute' });
  if (verdict && fault) {
    timeline.push({
      key: 'ai',
      title: 'AI analysed the case',
      text: `${fault.label}, ${pct}% confident.`,
      at: acted ? undefined : detail.updated_at,
    });
  }
  if (acted) {
    timeline.push({
      key: 'acted',
      title: 'Action taken',
      text: ACTION[detail.action_taken ?? ''] ?? detail.action_taken ?? undefined,
      at: detail.updated_at,
      kind: 'done',
    });
  }

  return (
    <>
      {back}
      <PageHeader
        title={reasonLabel(detail.reason)}
        subtitle={`${detail.dispute_id}${detail.amount ? ` · ${formatMoney(detail.amount.value, detail.amount.currency)} disputed` : ''}`}
        actions={<Badge tone={status.tone}>{status.label}</Badge>}
      />

      {notice && (
        <Notice tone={notice.ok ? 'good' : 'bad'} alert={!notice.ok}>
          {notice.text}
        </Notice>
      )}

      <div className={m.gridMain}>
        {/* AI recommendation and the human approval step */}
        <Card id="recommendation" title="AI recommendation">
          {verdict && fault && outcome ? (
            <>
              <div className={m.verdictHead}>
                <Badge tone={fault.tone}>{fault.label}</Badge>
                {verdict.needs_human && !acted && <Badge tone="warn">Needs a human decision</Badge>}
              </div>
              <p className={m.headline}>{outcome.headline}</p>
              <p className={u.muted} style={{ margin: 0 }}>
                {outcome.meaning}
              </p>

              <div className={m.recommend}>
                <div className={m.recommendLabel}>Recommended action</div>
                <div className={m.recommendMain}>
                  {describe(verdict.action, verdict.offer_type)}
                  {verdict.offer_amount ? ` · ${formatMoney(verdict.offer_amount, cur)}` : ''}
                </div>
                <div className={m.confidence}>
                  <div className={`${u.meter}`} role="img" aria-label={`Confidence ${pct} percent`}>
                    <div className={u.meterFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={u.muted}>{pct}% confidence</span>
                </div>
                <p className={m.followUp}>
                  Confidence is the AI&apos;s own estimate, not a guarantee that it is right.
                  {outcome.followUp ? ` ${outcome.followUp}` : ''}
                </p>
              </div>

              {acted ? (
                <Notice tone="good">
                  Resolved. Action taken: {ACTION[detail.action_taken ?? ''] ?? detail.action_taken}
                  {detail.updated_at ? ` on ${formatDateTime(detail.updated_at)}` : ''}.
                </Notice>
              ) : (
                <>
                  <p className={u.muted} style={{ margin: '0 0 0.6rem' }}>
                    Nothing is sent to PayPal until you review and approve it.
                  </p>
                  <div className={u.row}>
                    <button
                      className={u.btn}
                      disabled={busy !== null}
                      onClick={() => {
                        setForm(null);
                        setPending({ action: verdict.action, offerType: verdict.offer_type, amount: verdict.offer_amount, overriding: false });
                      }}
                    >
                      Review and approve
                    </button>
                    {verdict.action === 'MAKE_OFFER' && (
                      <button
                        className={`${u.btn} ${u.btnSecondary}`}
                        disabled={busy !== null}
                        onClick={() => setForm(form === 'edit' ? null : 'edit')}
                        aria-expanded={form === 'edit'}
                      >
                        Edit offer
                      </button>
                    )}
                    <button
                      className={`${u.btn} ${u.btnDanger}`}
                      disabled={busy !== null}
                      onClick={() => setForm(form === 'override' ? null : 'override')}
                      aria-expanded={form === 'override'}
                    >
                      Override
                    </button>
                  </div>
                  {form && (
                    <DecisionForm
                      key={form}
                      mode={form}
                      verdict={verdict}
                      max={detail.amount}
                      onCancel={() => setForm(null)}
                      onSubmit={(override) =>
                        setPending({
                          action: override.action,
                          offerType: override.offer_type,
                          amount: override.offer_amount,
                          overriding: form === 'override',
                          override,
                        })
                      }
                    />
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <p className={u.muted} style={{ marginTop: 0 }}>
                {detail.analysis_status === 'error'
                  ? 'The last analysis failed. You can try again.'
                  : 'The AI has not looked at this dispute yet.'}
              </p>
              <button className={u.btn} onClick={analyse} disabled={busy !== null}>
                {busy === 'analyse' ? 'Analysing…' : 'Run AI analysis'}
              </button>
            </>
          )}
        </Card>

        <Card id="details" title="Dispute details">
          <dl className={u.kv}>
            <dt>Dispute</dt>
            <dd>{detail.dispute_id}</dd>
            <dt>Amount</dt>
            <dd>{detail.amount ? formatMoney(detail.amount.value, detail.amount.currency) : '—'}</dd>
            <dt>Reason</dt>
            <dd>{reasonLabel(detail.reason)}</dd>
            <dt>Opened</dt>
            <dd>{formatDateTime(detail.created_at)}</dd>
            <dt>Order</dt>
            <dd className={u.mono}>{detail.order?.paypal_order_id ?? '—'}</dd>
            <dt>Mandate</dt>
            <dd className={u.mono}>{detail.mandate?.mandate_id ?? '—'}</dd>
          </dl>
        </Card>
      </div>

      {/* Mandate vs cart */}
      <Card id="comparison" title="Mandate vs cart" subtitle="What the buyer authorised compared with what the agent actually bought.">
        {constraints && cart ? (
          <MandateVsCart constraints={constraints} cart={cart} guard={guard} />
        ) : (
          <EmptyState title="Nothing to compare yet">This dispute is not linked to one of our mandates and carts, so there is nothing to compare.</EmptyState>
        )}
      </Card>

      {/* Fulfilment: be honest about what we do not have */}
      <Card id="fulfilment" title="Fulfilment and tracking">
        <p style={{ margin: 0 }}>
          {detail.order?.captured_at
            ? `Payment was captured on ${formatDateTime(detail.order.captured_at)}.`
            : 'No payment capture is recorded for this order.'}
        </p>
        {detail.order && (
          <p style={{ margin: '0.4rem 0 0' }}>
            {detail.order.payment_source === 'paypal'
              ? 'Paid with a PayPal account. '
              : detail.order.payment_source === 'card'
                ? 'Paid by card through PayPal guest checkout. '
                : ''}
            {
              {
                match: 'It is the PayPal account the buyer linked to MandatePay, so the buyer who signed the mandate paid.',
                different: 'It is not the PayPal account the buyer linked to MandatePay. Check who paid before accepting the claim.',
                not_linked: 'The buyer has not linked a PayPal account, so the payer cannot be matched to them.',
                unknown: 'The payer was not recorded for this order.',
              }[detail.order.payer_check]
            }
          </p>
        )}
        <p className={u.muted} style={{ margin: '0.4rem 0 0' }}>
          No shipping or tracking information is available. PayPal&apos;s dispute data does not include it yet, so the AI
          could not check delivery.
        </p>
      </Card>

      {/* Reasoning */}
      {verdict && (
        <Card id="reasoning" title="Why the AI decided this">
          <p style={{ margin: '0 0 0.9rem', whiteSpace: 'pre-wrap' }}>{verdict.reasoning}</p>
          {verdict.evidence_points.length > 0 ? (
            <>
              <strong>Supporting evidence</strong>
              <ul className={m.summaryList} style={{ marginTop: '0.4rem' }}>
                {verdict.evidence_points.map((p, i) => (
                  <li key={i}>
                    {p.claim} <span className={u.mono} title="Where in the case data this comes from">({p.source})</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={u.muted}>The AI cited no verifiable evidence, so a person should check this case.</p>
          )}
        </Card>
      )}

      {/* Evidence preview */}
      <Card
        id="evidence"
        title="Evidence summary"
        subtitle="A preview of the document that backs this case. Download it as a PDF built from the signed mandate, the cart and the payment record."
        actions={
          <div className={`${u.row} ${u.noPrint}`}>
            <a
              href={`/api/cases/${encodeURIComponent(detail.dispute_id)}/evidence-pack?download=1`}
              className={u.btn}
              style={{ textDecoration: 'none' }}
            >
              Download PDF
            </a>
            <Link href={`/merchant/evidence/${encodeURIComponent(detail.dispute_id)}`} className={`${u.btn} ${u.btnSecondary}`} style={{ textDecoration: 'none' }}>
              Open full page
            </Link>
          </div>
        }
      >
        <details>
          <summary className={u.rowLink} style={{ cursor: 'pointer', marginBottom: '0.75rem' }}>
            Show the summary preview
          </summary>
          <EvidenceSummary detail={detail} />
        </details>
      </Card>

      <Card id="timeline" title="Timeline">
        <ol className={m.timeline}>
          {timeline.map((e) => (
            <li key={e.key} className={`${m.event} ${e.kind === 'dispute' ? m.eventDispute : e.kind === 'done' ? m.eventDone : ''}`}>
              <strong>{e.title}</strong>
              {e.at ? <span className={u.muted}> · {formatDateTime(e.at)}</span> : null}
              {e.text && <div className={u.muted}>{e.text}</div>}
            </li>
          ))}
        </ol>
      </Card>

      {/* Confirmation before anything financially significant is sent */}
      <Dialog
        open={pending !== null}
        title={pending?.overriding ? 'Confirm your override' : 'Review before sending'}
        onClose={() => (busy ? undefined : setPending(null))}
        footer={
          <>
            <button className={`${u.btn} ${u.btnSecondary}`} onClick={() => setPending(null)} disabled={busy === 'act'}>
              Cancel
            </button>
            <button className={u.btn} onClick={() => pending && send(pending)} disabled={busy === 'act'}>
              {busy === 'act' ? 'Sending…' : 'Approve and send'}
            </button>
          </>
        }
      >
        {pending && verdict && (
          <>
            <dl className={m.confirmRows}>
              <dt>Action</dt>
              <dd>{describe(pending.action, pending.offerType)}</dd>
              <dt>Amount</dt>
              <dd>{pending.action === 'MAKE_OFFER' && pending.amount ? formatMoney(pending.amount, cur) : 'No money moves'}</dd>
              <dt>Reason</dt>
              <dd>
                {pending.overriding
                  ? `You are overriding the AI, which recommended: ${describe(verdict.action, verdict.offer_type)}.`
                  : verdict.reasoning.split('\n')[0]}
              </dd>
            </dl>
            {verdict.evidence_points.length > 0 && (
              <>
                <strong>Supporting evidence</strong>
                <ul className={m.summaryList}>
                  {verdict.evidence_points.slice(0, 4).map((p, i) => (
                    <li key={i}>{p.claim}</li>
                  ))}
                </ul>
              </>
            )}
            <Notice tone="warn">This is sent to PayPal as your decision. It cannot be undone.</Notice>
          </>
        )}
      </Dialog>
    </>
  );
}

/** Edit the offer, or override the AI with a different action. Validated before the confirmation dialog opens. */
function DecisionForm({
  mode,
  verdict,
  max,
  onCancel,
  onSubmit,
}: {
  mode: 'edit' | 'override';
  verdict: Verdict;
  max: CaseRecord['amount'];
  onCancel: () => void;
  onSubmit: (override: Override) => void;
}) {
  const [action, setAction] = useState<ActionType>(
    mode === 'edit' ? 'MAKE_OFFER' : verdict.action === 'SEND_MESSAGE' ? 'PROVIDE_EVIDENCE' : 'SEND_MESSAGE',
  );
  const [offerType, setOfferType] = useState<OfferType>(verdict.offer_type ?? 'REFUND');
  const [amount, setAmount] = useState(verdict.offer_amount ?? max?.value ?? '');
  const [touched, setTouched] = useState(false);

  const isOffer = action === 'MAKE_OFFER';
  let amountError: string | null = null;
  if (isOffer) {
    if (!/^\d+\.\d{2}$/.test(amount)) amountError = 'Use a number with two decimals, like 45.00.';
    else if (Number(amount) <= 0) amountError = 'The amount must be more than zero.';
    else if (max && Number(amount) > Number(max.value)) amountError = `The offer cannot be more than the disputed ${formatMoney(max.value, max.currency)}.`;
  }

  return (
    <form
      className={m.form}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (amountError) return;
        onSubmit(isOffer ? { action, offer_type: offerType, offer_amount: amount } : { action });
      }}
    >
      <strong>{mode === 'edit' ? 'Edit the offer' : 'Choose a different action'}</strong>
      {mode === 'override' && (
        <label className={u.field}>
          Action
          <select className={u.input} value={action} onChange={(e) => setAction(e.target.value as ActionType)}>
            {ACTION_LIST.map((a) => (
              <option key={a} value={a}>
                {ACTION[a]}
                {a === verdict.action ? ' (AI choice)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {isOffer && (
        <>
          <label className={u.field}>
            Offer type
            <select className={u.input} value={offerType} onChange={(e) => setOfferType(e.target.value as OfferType)}>
              {OfferType.options.map((o) => (
                <option key={o} value={o}>
                  {OFFER_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          <label className={u.field}>
            Amount{max ? ` (${max.currency})` : ''}
            <input
              className={u.input}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={touched && !!amountError}
            />
            {touched && amountError && <span className={u.fieldError}>{amountError}</span>}
          </label>
        </>
      )}
      <div className={u.row}>
        <button className={u.btn} type="submit">
          Continue
        </button>
        <button className={`${u.btn} ${u.btnSecondary}`} type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
