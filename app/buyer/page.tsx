'use client';
// OWNER: C. Buyer view: request -> mandate -> product recommendations -> cart and mandate check -> checkout.
// Uses apiFetch, which falls back to sample responses only when the backend cannot answer (see fixtures/api.ts).
// The product list is a demo catalogue (fixtures), not real PayPal listings, and is labelled that way.
import { useState } from 'react';
import type {
  Cart,
  Constraints,
  CreateMandateResponse,
  DraftMandateResponse,
  GuardResult,
} from '@/contracts/schemas';
import type { z } from 'zod';
import { ApiClientError, apiFetch } from '@/fixtures/api';
import { cartAllowed, cartBlocked, cartNeedsApproval } from '@/fixtures';
import { Badge, Card, Notice, PageHeader, ResultMark } from '../_ui/Ui';
import { CHECK_RESULT, formatDay, formatMoney, ruleLabel, titleCase } from '../_ui/labels';
import u from '../_ui/ui.module.css';
import Checkout from './Checkout';
import s from './buyer.module.css';

type Draft = z.infer<typeof DraftMandateResponse>;
type Created = z.infer<typeof CreateMandateResponse>;

const BUYER_REF = 'buyer_demo';
const EXAMPLE = 'Buy me white trainers, size 10, under 110 USD, delivered by Nov 20.';
const STEPS = ['Request', 'Mandate', 'Products', 'Review', 'Checkout'];

const PRODUCTS: { key: string; cart: Cart }[] = [
  { key: 'a', cart: cartAllowed },
  { key: 'b', cart: cartNeedsApproval },
  { key: 'c', cart: cartBlocked },
];

function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  return e instanceof Error ? e.message : 'Something went wrong';
}

export default function BuyerPage() {
  const [text, setText] = useState(EXAMPLE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mandate, setMandate] = useState<Created | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [busy, setBusy] = useState<'draft' | 'confirm' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingFixtures, setUsingFixtures] = useState(false);
  const [paid, setPaid] = useState(false);

  const cart = PRODUCTS.find((p) => p.key === selected)?.cart ?? null;
  // A blocked cart cannot be checked out, so the progress stays on "Review" until the buyer picks something else.
  const current = paid ? 5 : !draft ? 0 : !mandate ? 1 : !selected ? 2 : !guard || guard.verdict === 'block' ? 3 : 4;

  async function run<T>(kind: NonNullable<typeof busy>, fn: () => Promise<{ data: T; fromFixture: boolean }>) {
    setBusy(kind);
    setError(null);
    try {
      const r = await fn();
      if (r.fromFixture) setUsingFixtures(true);
      return r.data;
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onDraft() {
    const data = await run('draft', () => apiFetch<Draft>('/api/mandates/draft', { body: { request_text: text } }));
    if (data) {
      setDraft(data);
      setMandate(null);
      setSelected(null);
      setGuard(null);
      setPaid(false);
    }
  }

  async function onConfirm() {
    if (!draft) return;
    const data = await run('confirm', () =>
      apiFetch<Created>('/api/mandates', { body: { buyer_ref: BUYER_REF, constraints: draft.constraints } }),
    );
    if (data) {
      setMandate(data);
      setSelected(null);
      setGuard(null);
    }
  }

  /** Adding to the cart checks it against the mandate straight away, so the result is never out of date. */
  async function addToCart(key: string) {
    if (!mandate) return;
    const picked = PRODUCTS.find((p) => p.key === key)!.cart;
    setSelected(key);
    setGuard(null);
    setPaid(false);
    const data = await run('check', () =>
      apiFetch<GuardResult>('/api/carts/check', { body: { mandate_id: mandate.mandate_id, cart: picked } }),
    );
    if (data) setGuard(data);
  }

  function removeFromCart() {
    setSelected(null);
    setGuard(null);
    setPaid(false);
  }

  return (
    <>
      <PageHeader
        title="Buy with an AI agent"
        subtitle="You set the limits. Every purchase is checked against them before PayPal is charged."
      />

      <ol className={s.stepper} aria-label="Progress">
        {STEPS.map((label, i) => {
          const done = i < current;
          const cls = done ? s.stepDone : i === current ? s.stepCurrent : '';
          return (
            <li key={label} className={`${s.step} ${cls}`} aria-current={i === current ? 'step' : undefined}>
              <span className={s.stepNum}>{done ? '✓' : i + 1}</span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>

      {usingFixtures && <Notice tone="warn">Sample data: the server could not answer some steps, so example responses are shown.</Notice>}
      {error && (
        <Notice tone="bad" alert>
          {error}
        </Notice>
      )}

      {/* 1. Request */}
      <Card id="request" title="1. What do you want to buy?" subtitle="Write it the way you would tell a person. We turn it into limits you can review.">
        <label className={u.srOnly} htmlFor="request-text">
          Purchase request
        </label>
        <textarea
          id="request-text"
          className={s.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
        />
        <div className={u.row} style={{ marginTop: '0.75rem' }}>
          <button className={u.btn} onClick={onDraft} disabled={busy !== null || text.trim() === ''}>
            {busy === 'draft' ? 'Working…' : draft ? 'Update mandate' : 'Create mandate'}
          </button>
          <span className={`${u.muted} ${s.count}`}>{text.length}/1000</span>
        </div>
      </Card>

      {/* 2. Mandate */}
      {draft && (
        <Card
          id="mandate"
          title="2. Review your mandate"
          subtitle="These are your limits. Once you confirm, they are signed and nothing outside them can be bought."
          actions={mandate ? <Badge tone="good">✓ Signed</Badge> : undefined}
        >
          <MandateSummary constraints={draft.constraints} />
          {draft.warnings.length > 0 && (
            <div style={{ marginTop: '0.9rem' }}>
              <Notice tone="warn">
                <strong>Check these assumptions:</strong>
                <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
                  {draft.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Notice>
            </div>
          )}
          <div className={u.row} style={{ marginTop: '0.9rem' }}>
            {mandate ? (
              <span className={u.muted}>
                Confirmed as {mandate.mandate_id} · valid until {formatDay(mandate.expires_at)}
              </span>
            ) : (
              <button className={u.btn} onClick={onConfirm} disabled={busy !== null}>
                {busy === 'confirm' ? 'Signing…' : 'Confirm and sign mandate'}
              </button>
            )}
          </div>
        </Card>
      )}

      {/* 3. Products */}
      {mandate && (
        <Card
          id="products"
          title="3. Choose a product"
          subtitle="Demo catalogue: sample products for this demo, not real PayPal listings. Adding one checks it against your mandate."
        >
          <div className={s.products}>
            {PRODUCTS.map((p) => {
              const item = p.cart.items[0];
              const on = selected === p.key;
              return (
                <div key={p.key} className={`${s.product} ${on ? s.productOn : ''}`}>
                  <div className={s.productName}>{item.name}</div>
                  <div className={u.muted}>{p.cart.merchant}</div>
                  <div className={s.price}>{formatMoney(item.unit_price, p.cart.currency)}</div>
                  <div className={s.chips}>
                    {Object.entries(item.attributes ?? {}).map(([k, v]) => (
                      <span key={k} className={s.chip}>
                        {titleCase(k)}: {v}
                      </span>
                    ))}
                  </div>
                  <div className={u.muted}>{p.cart.delivery_eta ? `Delivery by ${formatDay(p.cart.delivery_eta)}` : 'No delivery estimate'}</div>
                  <div className={s.productFoot}>
                    <button
                      className={`${u.btn} ${on ? u.btnSecondary : ''}`}
                      onClick={() => addToCart(p.key)}
                      disabled={busy !== null || on}
                      aria-label={`${on ? 'In cart' : 'Add to cart'}: ${item.name}, ${formatMoney(item.unit_price, p.cart.currency)}`}
                    >
                      {on ? 'In your cart' : 'Add to cart'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* 4. Cart and mandate check, 5. Checkout */}
      {mandate && cart && (
        <Card id="cart" title="4. Your cart and mandate check">
          {cart.items.map((i) => (
            <div key={i.sku} className={s.cartItem}>
              <div>
                <strong>{i.name}</strong> × {i.quantity}
                <div className={u.muted}>
                  {Object.entries(i.attributes ?? {}).map(([k, v]) => `${titleCase(k)}: ${v}`).join(' · ')}
                </div>
                <div className={u.muted}>{cart.merchant}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className={s.price}>{formatMoney(i.unit_price, cart.currency)}</div>
                <button className={`${u.btn} ${u.btnSecondary}`} style={{ marginTop: '0.4rem' }} onClick={removeFromCart} disabled={busy !== null}>
                  Remove
                </button>
              </div>
            </div>
          ))}

          {busy === 'check' && !guard && <p className={u.muted}>Checking this cart against your mandate…</p>}
          {guard && <GuardView guard={guard} />}
          {guard && (
            <Checkout
              key={`${mandate.mandate_id}:${selected}`}
              mandateId={mandate.mandate_id}
              cart={cart}
              guard={guard}
              onFixture={() => setUsingFixtures(true)}
              onPaid={() => setPaid(true)}
            />
          )}
        </Card>
      )}
    </>
  );
}

function MandateSummary({ constraints: c }: { constraints: Constraints }) {
  const attrs = Object.entries(c.required_attributes ?? {});
  return (
    <>
      <dl className={u.kv}>
        <dt>Budget</dt>
        <dd>Up to {formatMoney(c.max_total.value, c.max_total.currency)}</dd>
        <dt>Product type</dt>
        <dd>{c.categories?.length ? c.categories.join(', ') : 'Any'}</dd>
        <dt>Size and attributes</dt>
        <dd>{attrs.length ? attrs.map(([k, v]) => `${titleCase(k)}: ${v}`).join(' · ') : 'None specified'}</dd>
        <dt>Quantity</dt>
        <dd>{c.max_quantity !== undefined ? `At most ${c.max_quantity}` : 'Any'}</dd>
        <dt>Delivery deadline</dt>
        <dd>{c.deadline ? formatDay(c.deadline) : 'No deadline'}</dd>
        <dt>Approval needed</dt>
        <dd>{c.require_approval_over ? `Above ${formatMoney(c.require_approval_over, c.max_total.currency)}` : 'Never'}</dd>
      </dl>
      {c.request_text && <p className={s.quote}>You said: &ldquo;{c.request_text}&rdquo;</p>}
    </>
  );
}

const VERDICT_TEXT: Record<GuardResult['verdict'], { cls: string; text: string; mark: 'pass' | 'fail' | 'escalate' }> = {
  allow: { cls: s.verdictAllow, text: 'Every rule passed. This cart matches your mandate.', mark: 'pass' },
  block: { cls: s.verdictBlock, text: 'Blocked. This cart breaks your mandate, so no order will be created.', mark: 'fail' },
  escalate: { cls: s.verdictEscalate, text: 'Nothing broke your mandate, but it needs your approval before it can be bought.', mark: 'escalate' },
};

function GuardView({ guard }: { guard: GuardResult }) {
  const v = VERDICT_TEXT[guard.verdict];
  return (
    <div>
      <div className={`${s.verdict} ${v.cls}`} role="status">
        <ResultMark status={v.mark} />
        <span>
          {v.text} <span style={{ fontWeight: 400 }}>Total {formatMoney(guard.total, guard.currency)}.</span>
        </span>
      </div>
      <ul className={s.checks}>
        {guard.checks.map((c) => {
          const res = CHECK_RESULT[c.status];
          return (
            <li key={c.rule} className={s.check}>
              <ResultMark status={c.status} />
              <div>
                <div className={s.checkName}>{ruleLabel(c.rule)}</div>
                <div className={u.muted}>{c.detail}</div>
              </div>
              <Badge tone={res.tone}>{res.label}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
