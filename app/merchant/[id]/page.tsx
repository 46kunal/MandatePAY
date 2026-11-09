'use client';
// OWNER: C. Case detail: AI verdict + actions, mandate-vs-cart diff, reasoning with evidence, timeline.
// Actions call POST /api/cases/:id/act (A). The analyst runs through POST /api/cases/:id/analyse (B).
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  ActionType,
  Cart,
  Constraints,
  GuardResult,
  OfferType,
  type CaseRecord,
  type Verdict,
} from '@/contracts/schemas';
import { ApiClientError, apiFetch } from '@/fixtures/api';
import type { CaseDetail } from '@/fixtures';
import { Badge, Shell } from '../../_ui/Shell';
import { ACTION, FAULT, STATUS, formatMoney, reasonLabel, type Tone } from '../../_ui/labels';
import u from '../../_ui/ui.module.css';
import { buildDiff, summarise, type DiffStatus } from './diff';
import d from './detail.module.css';

const OFFER_LABEL: Record<string, string> = {
  REFUND: 'Full refund',
  REFUND_WITH_RETURN: 'Refund after the item is returned',
  REFUND_WITH_REPLACEMENT: 'Refund with a replacement',
  REPLACEMENT_WITHOUT_REFUND: 'Replacement only',
};

const CHECK_TONE: Record<DiffStatus, { label: string; tone: Tone }> = {
  pass: { label: 'Match', tone: 'good' },
  fail: { label: 'Mismatch', tone: 'bad' },
  unsure: { label: 'Not confirmed', tone: 'warn' },
  escalate: { label: 'Needs approval', tone: 'warn' },
};

function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) {
    switch (e.body.error) {
      case 'already_acted':
        return 'This case was already handled.';
      case 'human_approval_required':
        return 'A person must approve this action first.';
      case 'paypal_not_configured':
        return 'PayPal is not configured on the server, so the action could not be sent.';
    }
    return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '');

function describe(v: Verdict): string {
  let s = ACTION[v.action] ?? v.action;
  if (v.action === 'MAKE_OFFER' && v.offer_type) {
    s += `: ${OFFER_LABEL[v.offer_type] ?? v.offer_type}`;
  }
  return s;
}

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loadError, setLoadError] = useState<{ notFound: boolean; text: string } | null>(null);
  const [fixtures, setFixtures] = useState(false);
  const [busy, setBusy] = useState<'act' | 'analyse' | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState<'edit' | 'override' | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const r = await apiFetch<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`, { signal });
        if (r.fromFixture) setFixtures(true);
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

  async function act(body: { human_approved: boolean; override?: unknown }) {
    setBusy('act');
    setNotice(null);
    try {
      const r = await apiFetch<CaseRecord>(`/api/cases/${encodeURIComponent(id)}/act`, { body });
      if (r.fromFixture) setFixtures(true);
      setDetail((cur) => (cur ? { ...cur, ...r.data } : cur));
      setConfirming(false);
      setForm(null);
      setNotice({ ok: true, text: `Done: ${ACTION[r.data.action_taken ?? ''] ?? r.data.action_taken ?? 'action'} was sent to PayPal.` });
    } catch (e) {
      setNotice({ ok: false, text: errMsg(e) });
      // 409: someone else already handled it, so what we are showing is stale. Reload the real state.
      if (e instanceof ApiClientError && e.status === 409) {
        setConfirming(false);
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
      if (r.fromFixture) setFixtures(true);
      setDetail((cur) =>
        cur ? { ...cur, verdict: r.data, analysis_status: r.data.needs_human ? 'awaiting_human' : 'analysed' } : cur,
      );
    } catch (e) {
      setNotice({ ok: false, text: `Analysis failed: ${errMsg(e)}` });
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <Shell active="merchant">
        <Link href="/merchant" className={d.back}>
          ← All disputes
        </Link>
        <div className={`${u.card} ${u.empty}`} role="alert">
          <h2>{loadError.notFound ? 'Case not found' : 'Could not load this case'}</h2>
          <p className={u.muted}>{loadError.notFound ? `There is no dispute called ${id}.` : loadError.text}</p>
          {!loadError.notFound && (
            <button className={u.btn} onClick={() => load()}>
              Try again
            </button>
          )}
        </div>
      </Shell>
    );
  }

  if (!detail) {
    return (
      <Shell active="merchant">
        <Link href="/merchant" className={d.back}>
          ← All disputes
        </Link>
        <div aria-busy="true" aria-label="Loading case">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${u.skeleton} ${d.skel}`} />
          ))}
        </div>
      </Shell>
    );
  }

  const status = STATUS[detail.analysis_status];
  const acted = detail.analysis_status === 'acted';
  const verdict = detail.verdict;
  const fault = verdict ? FAULT[verdict.fault] : null;

  const constraints = Constraints.safeParse(detail.mandate?.constraints);
  const cart = Cart.safeParse(detail.cart?.cart);
  const guard = GuardResult.safeParse(detail.cart?.guard);
  const rows = constraints.success && cart.success ? buildDiff(constraints.data, cart.data, guard.success ? guard.data : null) : null;
  const sum = rows ? summarise(rows) : null;

  const timeline: { key: string; title: string; text?: string; at?: string | null; kind?: 'dispute' | 'done' }[] = [];
  if (detail.mandate) {
    timeline.push({
      key: 'mandate',
      title: 'Buyer signed a mandate',
      text: constraints.success && constraints.data.request_text ? `"${constraints.data.request_text}"` : undefined,
    });
  }
  if (detail.cart) {
    const g = guard.success ? guard.data.verdict : null;
    timeline.push({
      key: 'cart',
      title: g === 'allow' ? 'Cart passed the guard' : g === 'escalate' ? 'Cart needed buyer approval' : 'Cart was checked',
      text: `Approved by the ${detail.cart.approved_by ?? 'agent'}.`,
    });
  }
  if (detail.order) {
    timeline.push({
      key: 'paid',
      title: 'Payment captured',
      text: `Order ${detail.order.paypal_order_id}`,
      at: detail.order.captured_at,
    });
  }
  timeline.push({
    key: 'dispute',
    title: 'Dispute opened',
    text: reasonLabel(detail.reason),
    at: detail.created_at,
    kind: 'dispute',
  });
  if (verdict) {
    timeline.push({
      key: 'ai',
      title: 'AI analysed the case',
      text: `${fault?.label}, ${Math.round(verdict.confidence * 100)}% confident.`,
      at: acted ? undefined : detail.updated_at,
    });
  }
  if (acted) {
    timeline.push({
      key: 'acted',
      title: 'Action taken',
      text: [ACTION[detail.action_taken ?? ''] ?? detail.action_taken, detail.outcome].filter(Boolean).join(' · '),
      at: detail.updated_at,
      kind: 'done',
    });
  }

  return (
    <Shell active="merchant">
      <Link href="/merchant" className={d.back}>
        ← All disputes
      </Link>
      <div className={u.pageHead}>
        <div>
          <h1 className={u.h1}>{reasonLabel(detail.reason)}</h1>
          <p className={u.sub}>
            {detail.dispute_id}
            {detail.amount ? ` · ${formatMoney(detail.amount.value, detail.amount.currency)} disputed` : ''}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {fixtures && (
        <div className={u.notice} role="status">
          Sample data: the disputes service is not available, so an example case is shown.
        </div>
      )}
      {notice && (
        <div className={`${u.notice} ${notice.ok ? u.noticeGood : u.noticeBad}`} role="status">
          {notice.text}
        </div>
      )}

      {/* 1. Verdict and actions */}
      <section className={`${u.card} ${d.section}`} aria-labelledby="verdict-h">
        <h2 id="verdict-h" className={d.h2}>
          AI recommendation
        </h2>
        {verdict && fault ? (
          <>
            <div className={d.titleRow}>
              <Badge tone={fault.tone}>{fault.label}</Badge>
              {verdict.needs_human && !acted && <Badge tone="warn">Needs a human decision</Badge>}
            </div>
            <p className={d.verdictLine}>{describe(verdict)}{verdict.offer_amount ? ` (${formatMoney(verdict.offer_amount, detail.amount?.currency ?? 'USD')})` : ''}</p>
            <div className={d.confidence}>
              <div className={d.bar} role="img" aria-label={`Confidence ${Math.round(verdict.confidence * 100)} percent`}>
                <div className={d.barFill} style={{ width: `${Math.round(verdict.confidence * 100)}%` }} />
              </div>
              <span className={u.muted}>{Math.round(verdict.confidence * 100)}% confident</span>
            </div>

            {acted ? (
              <p className={u.muted}>This case is closed. Action taken: {ACTION[detail.action_taken ?? ''] ?? detail.action_taken}.</p>
            ) : (
              <>
                <div className={d.actions}>
                  {confirming ? (
                    <>
                      <button className={u.btn} disabled={busy !== null} onClick={() => act({ human_approved: true })}>
                        {busy === 'act' ? 'Sending…' : `Yes, ${describe(verdict).toLowerCase()}`}
                      </button>
                      <button className={`${u.btn} ${u.btnGhost}`} disabled={busy !== null} onClick={() => setConfirming(false)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={u.btn}
                        disabled={busy !== null}
                        onClick={() => {
                          setForm(null);
                          setConfirming(true);
                        }}
                      >
                        Approve
                      </button>
                      {verdict.action === 'MAKE_OFFER' && (
                        <button
                          className={`${u.btn} ${u.btnGhost}`}
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
                    </>
                  )}
                </div>
                {form && (
                  <DecisionForm
                    key={form}
                    mode={form}
                    verdict={verdict}
                    max={detail.amount}
                    busy={busy === 'act'}
                    onCancel={() => setForm(null)}
                    onSubmit={(override) => act({ human_approved: true, override })}
                  />
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className={u.muted}>
              {detail.analysis_status === 'error'
                ? 'The last analysis failed. You can try again.'
                : 'The AI has not looked at this case yet.'}
            </p>
            <button className={u.btn} onClick={analyse} disabled={busy !== null}>
              {busy === 'analyse' ? 'Analysing…' : 'Run AI analysis'}
            </button>
          </>
        )}
      </section>

      {/* 2. Mandate vs cart */}
      <section className={`${u.card} ${d.section}`} aria-labelledby="diff-h">
        <h2 id="diff-h" className={d.h2}>
          What the buyer allowed vs what was bought
        </h2>
        {rows && sum && cart.success ? (
          <>
            <div className={`${d.summary} ${sum.tone === 'good' ? d.summaryGood : sum.tone === 'bad' ? d.summaryBad : d.summaryWarn}`}>
              {sum.text}
            </div>
            <div className={d.items}>
              {cart.data.items.map((i) => (
                <div key={i.sku}>
                  <strong>{i.name}</strong> × {i.quantity} · {formatMoney(i.unit_price, cart.data.currency)}
                </div>
              ))}
              <div className={u.muted}>{cart.data.merchant ?? ''}</div>
            </div>
            <table className={d.table}>
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Buyer&apos;s mandate</th>
                  <th>Cart</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = CHECK_TONE[r.status];
                  return (
                    <tr key={r.key} className={r.status === 'fail' ? d.rowFail : r.status === 'pass' ? '' : d.rowWarn}>
                      <td className={d.label}>{r.label}</td>
                      <td data-label="Mandate">{r.mandate}</td>
                      <td data-label="Cart">{r.cart}</td>
                      <td className={d.status} title={r.note}>
                        <Badge tone={t.tone}>{t.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : (
          <p className={u.muted}>
            This dispute is not linked to one of our mandates yet, so there is nothing to compare.
          </p>
        )}
      </section>

      {/* 3. Reasoning and evidence */}
      {verdict && (
        <section className={`${u.card} ${d.section}`} aria-labelledby="why-h">
          <h2 id="why-h" className={d.h2}>
            Why the AI decided this
          </h2>
          <p className={d.reasoning}>{verdict.reasoning}</p>
          {verdict.evidence_points.length > 0 && (
            <>
              <strong>Evidence</strong>
              <ul className={d.evidence}>
                {verdict.evidence_points.map((p, i) => (
                  <li key={i}>
                    {p.claim}
                    <span className={d.source} title="Where in the case data this comes from">
                      {p.source}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {/* 4. Timeline */}
      <section className={`${u.card} ${d.section}`} aria-labelledby="time-h">
        <h2 id="time-h" className={d.h2}>
          Timeline
        </h2>
        <ol className={d.timeline}>
          {timeline.map((e) => (
            <li key={e.key} className={`${d.event} ${e.kind === 'dispute' ? d.eventDispute : e.kind === 'done' ? d.eventDone : ''}`}>
              <strong>{e.title}</strong>
              {e.at ? <span className={u.muted}> · {when(e.at)}</span> : null}
              {e.text && <div className={u.muted}>{e.text}</div>}
            </li>
          ))}
        </ol>
        {detail.order?.receipt_hash && (
          <details>
            <summary className={u.muted}>Receipt proof</summary>
            <div className={d.mono}>
              Order {detail.order.paypal_order_id} · capture {detail.order.capture_id ?? 'n/a'}
              <br />
              {detail.order.receipt_hash}
            </div>
          </details>
        )}
      </section>
    </Shell>
  );
}

/** Edit the offer, or override the AI with a different action. Validated before anything is sent. */
function DecisionForm({
  mode,
  verdict,
  max,
  busy,
  onCancel,
  onSubmit,
}: {
  mode: 'edit' | 'override';
  verdict: Verdict;
  max: CaseRecord['amount'];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (override: { action: ActionType; offer_type?: OfferType; offer_amount?: string }) => void;
}) {
  const [action, setAction] = useState<ActionType>(mode === 'edit' ? 'MAKE_OFFER' : verdict.action === 'SEND_MESSAGE' ? 'PROVIDE_EVIDENCE' : 'SEND_MESSAGE');
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
      className={d.form}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (amountError) return;
        onSubmit(isOffer ? { action, offer_type: offerType, offer_amount: amount } : { action });
      }}
    >
      <strong>{mode === 'edit' ? 'Edit the offer' : 'Choose a different action'}</strong>
      {mode === 'override' && (
        <label className={d.field}>
          Action
          <select className={d.input} value={action} onChange={(e) => setAction(e.target.value as ActionType)}>
            {ActionType.options.map((a) => (
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
          <label className={d.field}>
            Offer type
            <select className={d.input} value={offerType} onChange={(e) => setOfferType(e.target.value as OfferType)}>
              {OfferType.options.map((o) => (
                <option key={o} value={o}>
                  {OFFER_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          <label className={d.field}>
            Amount{max ? ` (${max.currency})` : ''}
            <input
              className={d.input}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={touched && !!amountError}
            />
            {touched && amountError && <span className={d.fieldError}>{amountError}</span>}
          </label>
        </>
      )}
      <div className={d.actions}>
        <button className={u.btn} type="submit" disabled={busy}>
          {busy ? 'Sending…' : 'Send to PayPal'}
        </button>
        <button className={`${u.btn} ${u.btnGhost}`} type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
