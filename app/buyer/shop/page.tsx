'use client';
// OWNER: C. Buyer view: request -> signed mandate -> shop the store yourself or let the agent pick -> cart and
// mandate check -> checkout. Every step calls the real API; errors are shown as they are.
import { useCallback, useState } from 'react';
import type {
  AgentPick,
  AgentShopResponse,
  BuyerProduct,
  Cart,
  Constraints,
  CreateMandateResponse,
  DraftMandateResponse,
  GuardResult,
} from '@/contracts/schemas';
import type { z } from 'zod';
import { ApiClientError, apiFetch } from '@/app/_ui/api';
import { Badge, Card, Notice, PageHeader, ResultMark } from '../../_ui/Ui';
import { CHECK_RESULT, formatDay, formatMoney, ruleLabel, titleCase } from '../../_ui/labels';
import u from '../../_ui/ui.module.css';
import Checkout from '../Checkout';
import VoiceButton from '../VoiceButton';
import s from '../buyer.module.css';

type Draft = z.infer<typeof DraftMandateResponse>;
type Created = z.infer<typeof CreateMandateResponse>;
type Shopped = z.infer<typeof AgentShopResponse>;

const STEPS = ['Request', 'Mandate', 'Shop', 'Review', 'Checkout'];
const DAY_MS = 24 * 60 * 60 * 1000;

function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) return e.body.message ?? e.body.error ?? `Request failed (${e.status})`;
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** Rebuild a cart from catalog data after the buyer edits it, so names, prices and delivery always come from the catalog. */
function cartFrom(lines: { sku: string; quantity: number }[], catalog: BuyerProduct[], base: Omit<Cart, 'items'>): Cart | null {
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const items = lines
    .filter((l) => l.quantity > 0 && bySku.has(l.sku))
    .map((l) => {
      const p = bySku.get(l.sku)!;
      return {
        sku: p.sku,
        name: p.name,
        category: p.category,
        quantity: l.quantity,
        unit_price: p.unit_price,
        ...(Object.keys(p.attributes).length ? { attributes: p.attributes } : {}),
      };
    });
  if (!items.length) return null;
  const slowest = Math.max(...items.map((i) => bySku.get(i.sku)!.delivery_days));
  return { ...base, items, delivery_eta: new Date(Date.now() + slowest * DAY_MS).toISOString() };
}

export default function BuyerPage() {
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mandate, setMandate] = useState<Created | null>(null);
  const [shopped, setShopped] = useState<Shopped | null>(null);
  const [catalog, setCatalog] = useState<BuyerProduct[]>([]);
  const [seller, setSeller] = useState('the store');
  const [cart, setCart] = useState<Cart | null>(null);
  const [guard, setGuard] = useState<GuardResult | null>(null);
  const [addSku, setAddSku] = useState('');
  const [busy, setBusy] = useState<'draft' | 'confirm' | 'shop' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  // A blocked cart cannot be checked out, so the progress stays on "Review" until the buyer changes it.
  const current = paid ? 5 : !draft ? 0 : !mandate ? 1 : !cart ? 2 : !guard || guard.verdict === 'block' ? 3 : 4;

  async function run<T>(kind: NonNullable<typeof busy>, fn: () => Promise<{ data: T }>) {
    setBusy(kind);
    setError(null);
    try {
      return (await fn()).data;
    } catch (e) {
      setError(errMsg(e));
      return null;
    } finally {
      setBusy(null);
    }
  }

  function clearCart() {
    setShopped(null);
    setCart(null);
    setGuard(null);
    setPaid(false);
  }

  async function onDraft() {
    const data = await run('draft', () => apiFetch<Draft>('/api/mandates/draft', { body: { request_text: text } }));
    if (data) {
      setDraft(data);
      setMandate(null);
      clearCart();
    }
  }

  async function onConfirm() {
    if (!draft) return;
    const data = await run('confirm', () =>
      apiFetch<Created>('/api/mandates', { body: { constraints: draft.constraints } }),
    );
    if (data) {
      setMandate(data);
      clearCart();
      void loadCatalog(data.constraints.max_total.currency);
    }
  }

  /** What the buyer may browse: pictures, prices, the seller and availability (never stock counts). */
  const loadCatalog = useCallback(async (currency: string) => {
    try {
      const r = await apiFetch<{ seller: string; products: BuyerProduct[] }>(`/api/shop/catalog?currency=${encodeURIComponent(currency)}`);
      setCatalog(r.data.products);
      setSeller(r.data.seller);
    } catch {
      setCatalog([]);
    }
  }, []);

  async function onShop() {
    if (!mandate) return;
    clearCart();
    const result = await run('shop', () => apiFetch<Shopped>('/api/agent/shop', { body: { mandate_id: mandate.mandate_id } }));
    if (result) {
      setShopped(result);
      setCart(result.cart);
      setGuard(result.guard);
    }
  }

  /** Any change by the buyer is checked against the mandate again, so the result is never out of date. */
  async function changeCart(lines: { sku: string; quantity: number }[]) {
    if (!mandate) return;
    const base = cart ?? { currency: mandate.constraints.max_total.currency, merchant: seller };
    const next = cartFrom(lines, catalog, base);
    setGuard(null);
    setPaid(false);
    setCart(next);
    if (!next) return;
    const data = await run('check', () =>
      apiFetch<GuardResult>('/api/carts/check', { body: { mandate_id: mandate.mandate_id, cart: next } }),
    );
    if (data) setGuard(data);
  }

  const lines = cart?.items.map((i) => ({ sku: i.sku, quantity: i.quantity })) ?? [];
  const inCart = (sku: string) => lines.find((l) => l.sku === sku)?.quantity ?? 0;
  function addToCart(p: BuyerProduct) {
    const have = inCart(p.sku);
    if (have >= p.max_quantity) return;
    changeCart(have ? lines.map((l) => (l.sku === p.sku ? { ...l, quantity: have + 1 } : l)) : [...lines, { sku: p.sku, quantity: 1 }]);
  }
  const reasonFor = (sku: string): AgentPick | undefined => shopped?.picks.find((p) => p.sku === sku);

  return (
    <>
      <PageHeader
        title="Buy with an AI agent"
        subtitle="You set the limits. The agent shops within them, and every cart is checked before PayPal is charged."
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

      {error && (
        <Notice tone="bad" alert>
          {error}
        </Notice>
      )}

      {/* 1. Request */}
      <Card
        id="request"
        title="1. What do you want to buy?"
        subtitle="Write it the way you would tell a person: what, budget, size or colour, and when you need it."
      >
        <label className={u.srOnly} htmlFor="request-text">
          Purchase request
        </label>
        <textarea
          id="request-text"
          className={s.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder="For example: white running trainers, size 10, under 110 USD, delivered within two weeks"
        />
        <div className={u.row} style={{ marginTop: '0.75rem' }}>
          <button className={u.btn} onClick={onDraft} disabled={busy !== null || text.trim() === ''}>
            {busy === 'draft' ? 'Working…' : draft ? 'Update mandate' : 'Create mandate'}
          </button>
          <VoiceButton disabled={busy !== null} value={text} onChange={setText} />
          <span className={`${u.muted} ${s.count}`}>{text.length}/1000</span>
        </div>
        <p className={u.muted} style={{ margin: '0.5rem 0 0', fontSize: '0.85em' }}>
          Speaking only fills the box above. Your browser may send the audio to its speech service (Google or Apple) to turn it into text.
          Nothing is signed or paid until you click Create mandate.
        </p>
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
              <>
                {!(Number(draft.constraints.max_total.value) > 0) && (
                  <Notice tone="bad">
                    Your request has no budget, and a mandate must have one. Add it to your request (for example
                    &quot;under 30 USD&quot;) and click Update mandate.
                  </Notice>
                )}
                <button
                  className={u.btn}
                  onClick={onConfirm}
                  disabled={busy !== null || !(Number(draft.constraints.max_total.value) > 0)}
                >
                  {busy === 'confirm' ? 'Signing…' : 'Confirm and sign mandate'}
                </button>
              </>
            )}
          </div>
        </Card>
      )}

      {/* 3. Shop: pick things yourself, or let the agent choose */}
      {mandate && (
        <Card
          id="agent"
          title="3. Choose what to buy"
          subtitle="Browse and add things yourself, or let your agent pick for you. Either way, only what fits your mandate can be bought."
        >
          <div className={u.row}>
            <button className={u.btn} onClick={onShop} disabled={busy !== null}>
              {busy === 'shop' ? 'Agent is shopping…' : shopped ? 'Ask the agent again' : 'Let my agent pick for me'}
            </button>
            {shopped && <span className={u.muted}>Chose from {shopped.considered} available products.</span>}
          </div>
          {shopped && <p className={s.quote}>Agent: &ldquo;{shopped.summary}&rdquo;</p>}

          <h3 style={{ margin: '1.25rem 0 0.25rem', fontSize: '1rem' }}>Browse {seller}</h3>
          {catalog.length === 0 ? (
            <p className={u.muted}>Nothing is available in {mandate.constraints.max_total.currency} right now.</p>
          ) : (
            <div className={s.shopGrid} style={{ marginTop: '0.75rem' }}>
              {catalog.map((p) => {
                const have = inCart(p.sku);
                return (
                  <article key={p.sku} className={s.shopCard}>
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={s.shopImg} src={p.image_url} alt={p.name} loading="lazy" referrerPolicy="no-referrer" />
                    ) : (
                      <div className={s.shopImgFallback} aria-hidden="true">
                        {p.name.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <div className={s.shopBody}>
                      <strong>{p.name}</strong>
                      <span className={u.muted}>Sold by {seller}</span>
                      <div className={s.chips}>
                        {Object.entries(p.attributes).map(([k, v]) => (
                          <span key={k} className={s.chip}>
                            {titleCase(k)}: {v}
                          </span>
                        ))}
                      </div>
                      {p.description && <span className={u.muted}>{p.description}</span>}
                      <span className={u.muted}>
                        Delivery in about {p.delivery_days} day{p.delivery_days === 1 ? '' : 's'}
                        {p.availability === 'low_stock' ? ' · Selling fast' : ''}
                      </span>
                      <div className={s.shopFoot}>
                        <span className={s.price}>{formatMoney(p.unit_price, p.currency)}</span>
                        <button
                          className={have ? `${u.btn} ${u.btnSecondary}` : u.btn}
                          onClick={() => addToCart(p)}
                          disabled={busy !== null || have >= p.max_quantity}
                        >
                          {have ? `In cart (${have}) · Add one more` : 'Add to cart'}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* 4. Cart and mandate check, 5. Checkout */}
      {mandate && cart && (
        <Card id="cart" title="4. Your cart and mandate check" subtitle="Change anything you like; the cart is checked against your mandate again.">
          {cart.items.map((i) => {
            const pick = reasonFor(i.sku);
            const item = catalog.find((p) => p.sku === i.sku);
            const stock = item?.max_quantity ?? i.quantity;
            return (
              <div key={i.sku} className={s.cartItem}>
                <div className={s.cartLead}>
                  {item?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className={s.thumb} src={item.image_url} alt="" referrerPolicy="no-referrer" />
                  ) : (
                    <div className={`${s.thumb} ${s.shopImgFallback}`} style={{ aspectRatio: '1', fontSize: '1.2rem' }} aria-hidden="true">
                      {i.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                  <strong>{i.name}</strong>
                  <div className={u.muted}>Sold by {seller}</div>
                  <div className={u.muted}>
                    {[i.category, ...Object.entries(i.attributes ?? {}).map(([k, v]) => `${titleCase(k)}: ${v}`)]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {pick && <div className={u.muted}>Why the agent chose it: {pick.reason}</div>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={s.price}>{formatMoney(i.unit_price, cart.currency)}</div>
                  <div className={u.row} style={{ marginTop: '0.4rem', justifyContent: 'flex-end' }}>
                    <label className={u.srOnly} htmlFor={`qty-${i.sku}`}>
                      Quantity for {i.name}
                    </label>
                    <input
                      id={`qty-${i.sku}`}
                      type="number"
                      min={1}
                      max={stock}
                      value={i.quantity}
                      disabled={busy !== null}
                      style={{ width: '4rem' }}
                      onChange={(e) => {
                        const q = Math.max(1, Math.min(stock, Number(e.target.value) || 1));
                        changeCart(lines.map((l) => (l.sku === i.sku ? { ...l, quantity: q } : l)));
                      }}
                    />
                    <button
                      className={`${u.btn} ${u.btnSecondary}`}
                      onClick={() => changeCart(lines.filter((l) => l.sku !== i.sku))}
                      disabled={busy !== null}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {busy === 'check' && !guard && <p className={u.muted}>Checking this cart against your mandate…</p>}
          {guard && <GuardView guard={guard} />}
          {guard && (
            <Checkout
              key={`${mandate.mandate_id}:${lines.map((l) => `${l.sku}x${l.quantity}`).join(',')}`}
              mandateId={mandate.mandate_id}
              cart={cart}
              guard={guard}
              onPaid={() => setPaid(true)}
            />
          )}
        </Card>
      )}
      {mandate && (shopped || catalog.length > 0) && !cart && <Notice tone="warn">Your cart is empty. Add something from the store above, or ask your agent.</Notice>}
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
