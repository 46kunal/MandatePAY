'use client';
// OWNER: C. A printable evidence summary built only from the case data the API returned: the signed mandate, the cart,
// the guard result, the payment record and the AI assessment. It is a document preview, not a PayPal submission.
import type { CaseDetail } from '@/lib/paypal/cases';
import { CHECK_RESULT, FAULT, formatDateTime, formatMoney, reasonLabel, ruleLabel } from '../../_ui/labels';
import { parseCase, summariseConstraints } from '../../_ui/parse';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

export function EvidenceSummary({ detail }: { detail: CaseDetail }) {
  const { constraints, cart, guard } = parseCase(detail);
  const v = detail.verdict;

  return (
    <article className={m.doc} aria-label={`Evidence summary for dispute ${detail.dispute_id}`}>
      <h2 className={m.docTitle}>Evidence summary · {detail.dispute_id}</h2>
      <div className={u.muted}>Prepared from the ledger records for this order. Reason: {reasonLabel(detail.reason)}.</div>

      <section className={m.docSection}>
        <h3>Dispute</h3>
        <dl style={{ margin: 0 }}>
          <div>Amount disputed: {detail.amount ? formatMoney(detail.amount.value, detail.amount.currency) : 'Unknown'}</div>
          <div>Opened: {formatDateTime(detail.created_at)}</div>
          <div>Status: {detail.status ?? 'Unknown'}</div>
        </dl>
      </section>

      <section className={m.docSection}>
        <h3>Buyer&apos;s signed mandate</h3>
        {constraints && detail.mandate ? (
          <>
            <div>Mandate {detail.mandate.mandate_id}, valid until {formatDateTime(detail.mandate.expires_at)}.</div>
            <div>{summariseConstraints(constraints)}</div>
            {constraints.request_text && <div className={u.muted}>Buyer&apos;s words: &ldquo;{constraints.request_text}&rdquo;</div>}
          </>
        ) : (
          <div>No mandate is linked to this dispute.</div>
        )}
      </section>

      <section className={m.docSection}>
        <h3>Purchased cart and mandate check</h3>
        {cart ? (
          <>
            <ul style={{ margin: '0 0 0.5rem', paddingLeft: '1.1rem' }}>
              {cart.items.map((i) => (
                <li key={i.sku}>
                  {i.name} × {i.quantity} at {formatMoney(i.unit_price, cart.currency)}
                  {i.attributes ? ` (${Object.entries(i.attributes).map(([k, val]) => `${k}: ${val}`).join(', ')})` : ''}
                </li>
              ))}
            </ul>
            {guard ? (
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {guard.checks.map((c) => (
                  <li key={c.rule}>
                    {ruleLabel(c.rule)}: <strong>{CHECK_RESULT[c.status].label}</strong>. {c.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <div>No guard result was stored for this cart.</div>
            )}
            {detail.cart && <div className={u.muted}>Approved by the {detail.cart.approved_by ?? 'agent'}.</div>}
          </>
        ) : (
          <div>No cart is linked to this dispute.</div>
        )}
      </section>

      <section className={m.docSection}>
        <h3>Payment record</h3>
        {detail.order ? (
          <>
            <div>
              Order {detail.order.paypal_order_id} · capture {detail.order.capture_id ?? 'not captured'} · status{' '}
              {detail.order.status}
            </div>
            {detail.order.captured_at && <div>Captured: {formatDateTime(detail.order.captured_at)}</div>}
            {detail.order.receipt_hash && (
              <div>
                Receipt hash (binds mandate, cart, order and capture): <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{detail.order.receipt_hash}</span>
              </div>
            )}
          </>
        ) : (
          <div>No order is linked to this dispute.</div>
        )}
      </section>

      <section className={m.docSection}>
        <h3>AI assessment</h3>
        {v ? (
          <>
            <div>
              <strong>{FAULT[v.fault].label}</strong> · confidence {Math.round(v.confidence * 100)}% (an estimate, not a guarantee)
            </div>
            <p style={{ margin: '0.4rem 0', whiteSpace: 'pre-wrap' }}>{v.reasoning}</p>
            {v.evidence_points.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {v.evidence_points.map((p, i) => (
                  <li key={i}>{p.claim}</li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div>The AI has not analysed this case yet.</div>
        )}
      </section>
    </article>
  );
}
