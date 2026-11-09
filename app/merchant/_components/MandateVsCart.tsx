'use client';
// OWNER: C. The main visual: what the buyer authorised (left) next to what the agent bought (right), one block per
// rule, each with a clear pass / fail / needs-attention result and, when it is not a pass, why it matters.
import type { Cart, Constraints, GuardResult } from '@/contracts/schemas';
import { CHECK_RESULT, formatMoney } from '../../_ui/labels';
import { Badge, ResultMark } from '../../_ui/Ui';
import { buildDiff, summarise } from '../disputes/[id]/diff';
import u from '../../_ui/ui.module.css';
import m from '../merchant.module.css';

export function MandateVsCart({
  constraints,
  cart,
  guard,
}: {
  constraints: Constraints;
  cart: Cart;
  guard: GuardResult | null;
}) {
  const rows = buildDiff(constraints, cart, guard);
  const sum = summarise(rows);
  const bar = sum.tone === 'good' ? m.summaryGood : sum.tone === 'bad' ? m.summaryBad : m.summaryWarn;

  return (
    <div>
      <div className={`${m.summaryBar} ${bar}`} role="status">
        {sum.text}
      </div>
      <p className={m.itemLine}>
        Purchased from {cart.merchant ?? 'an unknown merchant'}:{' '}
        {cart.items.map((i) => `${i.name} × ${i.quantity} (${formatMoney(i.unit_price, cart.currency)})`).join(', ')}
      </p>

      <div className={m.sideTitles} aria-hidden="true">
        <div className={m.sideTitle}>What the buyer authorised</div>
        <div className={m.sideTitle}>What the agent purchased</div>
      </div>

      {rows.map((r) => {
        const tone = r.status === 'pass' ? m.rulePass : r.status === 'fail' ? m.ruleFail : m.ruleWarn;
        const colTone = r.status === 'fail' ? m.colBad : r.status === 'pass' ? '' : m.colWarn;
        const res = CHECK_RESULT[r.status];
        return (
          <div key={r.key} className={`${m.rule} ${tone}`} data-rule={r.key} data-status={r.status}>
            <div className={m.ruleHead}>
              <ResultMark status={r.status} />
              <span className={m.ruleName}>{r.label}</span>
              <span className={m.ruleResult}>
                <Badge tone={res.tone}>{res.label}</Badge>
              </span>
            </div>
            <div className={m.ruleCols}>
              <div className={m.col}>
                <div className={m.colLabel}>What the buyer authorised</div>
                {r.mandate}
              </div>
              <div className={`${m.col} ${colTone}`}>
                <div className={m.colLabel}>What the agent purchased</div>
                {r.cart}
              </div>
            </div>
            {r.why && (
              <div className={`${m.why} ${r.status === 'fail' ? m.whyBad : m.whyWarn}`}>
                <strong>Why this matters: </strong>
                {r.why}
                {r.note && <div className={u.muted}>System check: {r.note}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
