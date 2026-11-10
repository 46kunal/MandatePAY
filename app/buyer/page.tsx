'use client';
// OWNER: C. The buyer's home. It opens with a greeting and one clear way to start, and shows what is already going on
// (mandates that are active, recent orders) instead of dropping straight into the purchase form.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { MyMandate, MyOrder } from '@/contracts/schemas';
import { useSession } from '@/lib/auth/client';
import { apiFetch } from '../_ui/api';
import { Icon } from '../_ui/Icons';
import { formatDay, formatMoney } from '../_ui/labels';
import { Badge, Skeleton } from '../_ui/Ui';
import u from '../_ui/ui.module.css';
import h from './home.module.css';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export default function BuyerHome() {
  // Time of day depends on the visitor's clock, so it is decided in the browser only (no server mismatch).
  const [hello, setHello] = useState('Welcome');
  useEffect(() => setHello(greeting()), []);
  const { data } = useSession();
  const first = data?.user?.name?.trim().split(/\s+/)[0];
  const [mandates, setMandates] = useState<MyMandate[] | null>(null);
  const [orders, setOrders] = useState<MyOrder[] | null>(null);

  useEffect(() => {
    apiFetch<{ mandates: MyMandate[] }>('/api/me/mandates')
      .then((r) => setMandates(r.data.mandates))
      .catch(() => setMandates([]));
    apiFetch<{ orders: MyOrder[] }>('/api/me/orders')
      .then((r) => setOrders(r.data.orders))
      .catch(() => setOrders([]));
  }, []);

  const active = mandates?.filter((m) => m.status === 'active') ?? [];

  return (
    <>
      <section className={h.hero} aria-label="Start a purchase">
        <span className={h.seal} aria-hidden="true">
          Signed
          <br />
          &amp; sealed
        </span>
        <div>
          <h1>
            {hello}
            {first ? `, ${first}` : ''}
          </h1>
          <p>Tell your agent what you need and set your limits. You can type it or say it, and you approve everything before you pay.</p>
        </div>
        <Link href="/buyer/shop" className={h.heroBtn}>
          <Icon name="bag" />
          Start a purchase
          <Icon name="arrow" size={16} />
        </Link>
      </section>

      <div className={h.grid}>
        <section className={h.panel} aria-labelledby="mandates-h">
          <div className={h.panelHead}>
            <h2 id="mandates-h">Your active mandates</h2>
            <Link href="/buyer/account#mandates">Manage</Link>
          </div>
          {!mandates && <Skeleton height={90} label="Loading your mandates" />}
          {mandates && active.length === 0 && (
            <p className={h.empty}>
              No active mandate. <Link href="/buyer/shop">Start a purchase</Link> to create one.
            </p>
          )}
          {active.slice(0, 4).map((m) => (
            <div key={m.mandate_id} className={h.row}>
              <div className={h.grow}>
                <b>{m.request_text ?? 'Purchase mandate'}</b>
                <span className={u.muted}>
                  Up to {formatMoney(m.max_total.value, m.max_total.currency)} · until {formatDay(m.expires_at)}
                </span>
              </div>
              <Badge tone="good">Active</Badge>
            </div>
          ))}
        </section>

        <section className={h.panel} aria-labelledby="orders-h">
          <div className={h.panelHead}>
            <h2 id="orders-h">Recent orders</h2>
            <Link href="/buyer/orders">See all</Link>
          </div>
          {!orders && <Skeleton height={90} label="Loading your orders" />}
          {orders && orders.length === 0 && (
            <p className={h.empty}>
              You have not bought anything yet. <Link href="/buyer/shop">Browse the store</Link>.
            </p>
          )}
          {orders?.slice(0, 5).map((o) => (
            <div key={o.paypal_order_id} className={h.row}>
              {o.images[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={h.thumb} src={o.images[0]} alt="" referrerPolicy="no-referrer" />
              ) : (
                <div className={h.thumb} aria-hidden="true">
                  {(o.items[0] ?? '?').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className={h.grow}>
                <b>{o.items.join(', ')}</b>
                <span className={u.muted}>Sold by {o.seller}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 600 }}>{formatMoney(o.total.value, o.total.currency)}</div>
                {o.report?.status === 'open' ? <Badge tone="warn">Reported</Badge> : o.refunded ? <Badge tone="info">Refunded</Badge> : null}
              </div>
            </div>
          ))}
        </section>
      </div>

      <div className={h.steps}>
        <div className={h.step}>
          <span className={h.num}>1</span>
          <span>
            <b>Say what you want</b>Budget, size, colour, when you need it.
          </span>
        </div>
        <div className={h.step}>
          <span className={h.num}>2</span>
          <span>
            <b>Sign your limits</b>Nothing outside them can be bought.
          </span>
        </div>
        <div className={h.step}>
          <span className={h.num}>3</span>
          <span>
            <b>Shop and pay</b>Browse yourself or let your agent pick, then pay with PayPal or a card.
          </span>
        </div>
      </div>
    </>
  );
}
