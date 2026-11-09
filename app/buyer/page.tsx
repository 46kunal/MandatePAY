'use client';
// OWNER: C. Buyer view: request box -> mandate card + Confirm -> cart preview (pass/fail per guard rule).
// Uses apiFetch, which falls back to fixtures when a route answers 501 (see fixtures/api.ts).
// PayPal checkout (C3) lives in ./Checkout.tsx, shown below the guard result.
import { useState } from 'react';
import Link from 'next/link';
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
import Checkout from './Checkout';
import s from './buyer.module.css';

type Draft = z.infer<typeof DraftMandateResponse>;
type Created = z.infer<typeof CreateMandateResponse>;

const BUYER_REF = 'buyer_demo';
const EXAMPLE = 'Buy me white trainers, size 10, under 110 USD, delivered by Nov 20.';

const CART_OPTIONS: { key: string; label: string; cart: Cart }[] = [
  { key: 'allowed', label: 'Matches the mandate', cart: cartAllowed },
  { key: 'approval', label: 'Needs my approval', cart: cartNeedsApproval },
  { key: 'blocked', label: 'Violates the mandate', cart: cartBlocked },
];

function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  return e instanceof Error ? e.message : 'Something went wrong';
}

function money(v: string, c: string) {
  return `${v} ${c}`;
}

export default function BuyerPage() {
  const [text, setText] = useState(EXAMPLE);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mandate, setMandate] = useState<Created | null>(null);
  const [cartKey, setCartKey] = useState(CART_OPTIONS[0].key);
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [busy, setBusy] = useState<'draft' | 'confirm' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usingFixtures, setUsingFixtures] = useState(false);

  const cart = CART_OPTIONS.find((c) => c.key === cartKey)!.cart;

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
      setGuard(null);
    }
  }

  async function onConfirm() {
    if (!draft) return;
    const data = await run('confirm', () =>
      apiFetch<Created>('/api/mandates', { body: { buyer_ref: BUYER_REF, constraints: draft.constraints } }),
    );
    if (data) {
      setMandate(data);
      setGuard(null);
    }
  }

  async function onCheck(key = cartKey) {
    if (!mandate) return;
    const picked = CART_OPTIONS.find((c) => c.key === key)!.cart;
    const data = await run('check', () =>
      apiFetch<GuardResult>('/api/carts/check', { body: { mandate_id: mandate.mandate_id, cart: picked } }),
    );
    if (data) setGuard(data);
  }

  function pickCart(key: string) {
    setCartKey(key);
    setGuard(null);
  }

  return (
    <main className={s.page}>
      <header className={s.header}>
        <h1 className={s.title}>Buyer</h1>
        <nav className={s.nav}>
          <Link href="/">Home</Link>
          <Link href="/merchant">Merchant view</Link>
        </nav>
      </header>

      {usingFixtures && (
        <div className={s.banner} role="status">
          Demo data: some API routes are not built yet, so sample responses are shown.
        </div>
      )}

      {/* 1. Request */}
      <section className={s.step}>
        <h2 className={s.stepTitle}>
          <span className={s.num}>1</span> Tell your agent what to buy
        </h2>
        <textarea
          className={s.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          aria-label="Purchase request"
        />
        <div className={s.row}>
          <button className={s.btn} onClick={onDraft} disabled={busy !== null || text.trim() === ''}>
            {busy === 'draft' ? 'Drafting…' : 'Draft mandate'}
          </button>
          <span className={s.muted}>{text.length}/1000</span>
        </div>
      </section>

      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}

      {/* 2. Mandate card */}
      {draft && (
        <section className={s.step}>
          <h2 className={s.stepTitle}>
            <span className={s.num}>2</span> Review your mandate
          </h2>
          <MandateCard constraints={draft.constraints} />
          {draft.warnings.length > 0 && (
            <ul className={s.warnings}>
              {draft.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <div className={s.row}>
            {mandate ? (
              <span className={`${s.badge} ${s.pass}`}>
                Confirmed · {mandate.mandate_id}
              </span>
            ) : (
              <button className={s.btn} onClick={onConfirm} disabled={busy !== null}>
                {busy === 'confirm' ? 'Signing…' : 'Confirm & sign mandate'}
              </button>
            )}
            {mandate && <span className={s.muted}>Expires {new Date(mandate.expires_at).toLocaleDateString()}</span>}
          </div>
        </section>
      )}

      {/* 3. Cart preview */}
      {mandate && (
        <section className={s.step}>
          <h2 className={s.stepTitle}>
            <span className={s.num}>3</span> Cart your agent wants to buy
          </h2>
          <div className={s.chips} role="group" aria-label="Sample agent cart">
            {CART_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={`${s.chip} ${o.key === cartKey ? s.chipOn : ''}`}
                onClick={() => pickCart(o.key)}
                aria-pressed={o.key === cartKey}
              >
                {o.label}
              </button>
            ))}
          </div>
          <CartView cart={cart} />
          <div className={s.row}>
            <button className={s.btn} onClick={() => onCheck()} disabled={busy !== null}>
              {busy === 'check' ? 'Checking…' : 'Check against mandate'}
            </button>
          </div>
          {guard && <GuardView guard={guard} />}
          {guard && (
            <Checkout
              key={`${mandate.mandate_id}:${cartKey}`}
              mandateId={mandate.mandate_id}
              cart={cart}
              guard={guard}
              onFixture={() => setUsingFixtures(true)}
            />
          )}
        </section>
      )}
    </main>
  );
}

function MandateCard({ constraints: c }: { constraints: Constraints }) {
  return (
    <dl className={s.grid}>
      <div>
        <dt>Max total</dt>
        <dd>{money(c.max_total.value, c.max_total.currency)}</dd>
      </div>
      <div>
        <dt>Categories</dt>
        <dd>{c.categories?.join(', ') ?? 'Any'}</dd>
      </div>
      <div>
        <dt>Max quantity</dt>
        <dd>{c.max_quantity ?? 'Any'}</dd>
      </div>
      <div>
        <dt>Required attributes</dt>
        <dd>
          {c.required_attributes
            ? Object.entries(c.required_attributes)
                .map(([k, v]) => `${k}: ${v}`)
                .join(', ')
            : 'None'}
        </dd>
      </div>
      <div>
        <dt>Deliver by</dt>
        <dd>{c.deadline ? new Date(c.deadline).toLocaleDateString() : 'No deadline'}</dd>
      </div>
      <div>
        <dt>Ask me first over</dt>
        <dd>{c.require_approval_over ? money(c.require_approval_over, c.max_total.currency) : 'Never'}</dd>
      </div>
    </dl>
  );
}

function CartView({ cart }: { cart: Cart }) {
  return (
    <div className={s.cart}>
      {cart.items.map((i) => (
        <div key={i.sku} className={s.cartItem}>
          <div>
            <strong>{i.name}</strong> × {i.quantity}
            <div className={s.muted}>
              {i.attributes ? Object.entries(i.attributes).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''}
            </div>
          </div>
          <div>{money(i.unit_price, cart.currency)}</div>
        </div>
      ))}
      <div className={s.muted}>
        {cart.merchant ?? 'Unknown merchant'}
        {cart.delivery_eta ? ` · delivery ${new Date(cart.delivery_eta).toLocaleDateString()}` : ''}
      </div>
    </div>
  );
}

const VERDICT_TEXT: Record<GuardResult['verdict'], { cls: string; text: string }> = {
  allow: { cls: s.verdictAllow, text: 'Allowed: every rule passed.' },
  block: { cls: s.verdictBlock, text: 'Blocked: this cart breaks your mandate. No order will be created.' },
  escalate: { cls: s.verdictEscalate, text: 'Needs your approval before it can be bought.' },
};

function GuardView({ guard }: { guard: GuardResult }) {
  const v = VERDICT_TEXT[guard.verdict];
  return (
    <div>
      <div className={`${s.verdict} ${v.cls}`}>
        {v.text} <span className={s.muted}>Total {money(guard.total, guard.currency)}</span>
      </div>
      <ul className={s.checks}>
        {guard.checks.map((c) => (
          <li key={c.rule} className={s.check}>
            <span className={`${s.badge} ${s[c.status]}`}>{c.status}</span>
            <div>
              <div className={s.rule}>{c.rule.replace(/_/g, ' ')}</div>
              <div className={s.muted}>{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
