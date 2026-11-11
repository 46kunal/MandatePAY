'use client';
// Merchant catalog: the only products the shopping agent may buy. Data lives in Postgres (GET/POST /api/products,
// PATCH /api/products/:id). Products are hidden, never deleted, because orders and evidence refer to them.
import { useCallback, useEffect, useState } from 'react';
import type { Product, ProductInput } from '@/contracts/schemas';
import { ApiClientError, apiFetch } from '@/app/_ui/api';
import { Badge, Card, EmptyState, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import { formatMoney, titleCase } from '../../_ui/labels';
import u from '../../_ui/ui.module.css';

const EMPTY = {
  sku: '',
  name: '',
  description: '',
  category: '',
  unit_price: '',
  currency: 'USD',
  attributes: '',
  stock: '1',
  delivery_days: '3',
  image_url: '',
  seller: '',
};
type Form = typeof EMPTY;

function errMsg(e: unknown): string {
  if (e instanceof ApiClientError) {
    const issues = Array.isArray(e.body.details)
      ? (e.body.details as { path?: unknown[]; message?: string }[]).map((i) => `${(i.path ?? []).join('.')}: ${i.message}`).join('; ')
      : '';
    return [e.body.message ?? e.body.error ?? `Request failed (${e.status})`, issues].filter(Boolean).join(' ');
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

/** "color=white, size=10" -> { color: "white", size: "10" } */
function parseAttributes(text: string): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const part of text.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [k, ...rest] = part.split('=');
    const v = rest.join('=').trim();
    if (!k?.trim() || !v) return `Write attributes as key=value, separated by commas (got "${part}").`;
    out[k.trim().toLowerCase()] = v;
  }
  return out;
}

function toInput(f: Form): ProductInput | string {
  const attributes = parseAttributes(f.attributes);
  if (typeof attributes === 'string') return attributes;
  const price = Number(f.unit_price);
  if (!Number.isFinite(price) || price <= 0) return 'Price must be a number above 0.';
  return {
    sku: f.sku.trim(),
    name: f.name.trim(),
    ...(f.description.trim() ? { description: f.description.trim() } : {}),
    category: f.category.trim(),
    unit_price: price.toFixed(2),
    currency: f.currency.trim().toUpperCase(),
    attributes,
    stock: Math.max(0, Math.floor(Number(f.stock) || 0)),
    delivery_days: Math.max(0, Math.floor(Number(f.delivery_days) || 0)),
    ...(f.image_url.trim() ? { image_url: f.image_url.trim() } : {}),
    ...(f.seller.trim() ? { seller: f.seller.trim() } : {}),
  };
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setProducts((await apiFetch<Product[]>('/api/products')).data);
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const input = toInput(form);
    if (typeof input === 'string') return setFormError(input);
    setBusy('add');
    setFormError(null);
    try {
      await apiFetch<Product>('/api/products', { body: input });
      setForm({ ...EMPTY, currency: form.currency });
      setAdding(false);
      await load();
    } catch (err) {
      setFormError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function patch(p: Product, body: Record<string, unknown>) {
    setBusy(p.product_id);
    setLoadError(null);
    try {
      const updated = (await apiFetch<Product>(`/api/products/${encodeURIComponent(p.product_id)}`, { method: 'PATCH', body })).data;
      setProducts((all) => all?.map((x) => (x.product_id === updated.product_id ? updated : x)) ?? null);
    } catch (err) {
      setLoadError(errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className={u.field}>
      <label htmlFor={`p-${key}`}>{label}</label>
      <input
        id={`p-${key}`}
        className={u.input}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Your catalog. The shopping agent can only buy active, in-stock products listed here, at these prices."
        actions={
          <button className={adding ? `${u.btn} ${u.btnSecondary}` : u.btn} onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            {adding ? 'Close' : 'Add a product'}
          </button>
        }
      />

      {loadError && (
        <Notice tone="bad" alert>
          {loadError}{' '}
          <button className={`${u.btn} ${u.btnSecondary}`} onClick={load}>
            Try again
          </button>
        </Notice>
      )}

      {(adding || (products && products.length === 0)) && (
      <Card id="add" title="Add a product" subtitle="A picture link is optional; buyers see it in the store.">
        <form onSubmit={add}>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {field('name', 'Name', { required: true, maxLength: 127 })}
            {field('sku', 'SKU', { required: true, maxLength: 64 })}
            {field('category', 'Category', { required: true, placeholder: 'e.g. trainers' })}
            {field('unit_price', 'Price', { required: true, inputMode: 'decimal', placeholder: '89.00' })}
            {field('currency', 'Currency', { required: true, maxLength: 3, placeholder: 'USD' })}
            {field('stock', 'In stock', { type: 'number', min: 0, required: true })}
            {field('delivery_days', 'Delivery (days)', { type: 'number', min: 0, max: 365, required: true })}
            {field('attributes', 'Attributes', { placeholder: 'color=white, size=10' })}
            {field('seller', 'Seller brand (optional)', { placeholder: 'Shown to buyers as Sold by' })}
            {field('image_url', 'Picture link (optional)', { type: 'url', placeholder: 'https://… (shown to buyers)' })}
          </div>
          <div className={u.field} style={{ marginTop: '0.75rem' }}>
            <label htmlFor="p-description">Description (optional)</label>
            <input
              id="p-description"
              className={u.input}
              value={form.description}
              maxLength={1000}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          {formError && (
            <div style={{ marginTop: '0.75rem' }}>
              <Notice tone="bad" alert>
                {formError}
              </Notice>
            </div>
          )}
          <div className={u.row} style={{ marginTop: '0.75rem' }}>
            <button className={u.btn} type="submit" disabled={busy !== null}>
              {busy === 'add' ? 'Adding…' : 'Add product'}
            </button>
          </div>
        </form>
      </Card>
      )}

      {!products && !loadError && <Skeleton height={120} label="Loading products" />}
      {products && products.length === 0 && (
        <EmptyState title="No products yet">Add your first product with the form above. The shopping agent has nothing to buy until you do.</EmptyState>
      )}
      {products && products.length > 0 && (
        <Card id="catalog" title={`Catalog (${products.filter((p) => p.active).length} active of ${products.length})`}>
          <div className={u.tableWrap}>
            <table className={u.table}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>In stock</th>
                  <th>Delivery</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.product_id}>
                    <td>
                      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        {p.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.image_url} alt="" width={44} height={44} style={{ borderRadius: 8, objectFit: 'cover', flex: 'none' }} referrerPolicy="no-referrer" />
                        ) : (
                          <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg-2)', display: 'grid', placeItems: 'center', fontWeight: 700, color: 'var(--muted)', flex: 'none' }}>
                            {p.name.slice(0, 1).toUpperCase()}
                          </span>
                        )}
                        <div>
                      <strong>{p.name}</strong>
                      <div className={u.muted}>
                        {[p.sku, p.seller, p.category, ...Object.entries(p.attributes).map(([k, v]) => `${titleCase(k)}: ${v}`)].filter(Boolean).join(' · ')}
                      </div>
                        </div>
                      </div>
                    </td>
                    <td>{formatMoney(p.unit_price, p.currency)}</td>
                    <td>
                      <label className={u.srOnly} htmlFor={`stock-${p.product_id}`}>
                        Stock for {p.name}
                      </label>
                      <input
                        id={`stock-${p.product_id}`}
                        className={u.input}
                        type="number"
                        min={0}
                        defaultValue={p.stock}
                        style={{ width: '5rem' }}
                        disabled={busy === p.product_id}
                        onBlur={(e) => {
                          const stock = Math.max(0, Math.floor(Number(e.target.value) || 0));
                          if (stock !== p.stock) patch(p, { stock });
                        }}
                      />
                    </td>
                    <td>{p.delivery_days} days</td>
                    <td>
                      <div className={u.row}>
                        {p.active ? <Badge tone="good">Active</Badge> : <Badge tone="neutral">Hidden</Badge>}
                        <button
                          className={`${u.btn} ${u.btnSecondary}`}
                          disabled={busy === p.product_id}
                          onClick={() => patch(p, { active: !p.active })}
                        >
                          {p.active ? 'Hide' : 'Show'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
