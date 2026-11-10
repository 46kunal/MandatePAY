'use client';
// OWNER: C. The buyer's own account: mandates (with Revoke), profile, password, signed-in devices, and a data export.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { MyMandate } from '@/contracts/schemas';
import { PasswordCard, PayPalCard, ProfileCard, SessionsCard } from '../../_ui/AccountPanels';
import { apiFetch } from '../../_ui/api';
import { MyOrdersCard } from './MyOrders';
import { formatDateTime, formatMoney } from '../../_ui/labels';
import { Badge, Card, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';

const STATUS: Record<MyMandate['status'], { text: string; tone: 'good' | 'neutral' | 'warn' }> = {
  active: { text: 'Active', tone: 'good' },
  expired: { text: 'Expired', tone: 'neutral' },
  revoked: { text: 'Revoked', tone: 'warn' },
};

function MandatesCard() {
  const [mandates, setMandates] = useState<MyMandate[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setMandates((await apiFetch<{ mandates: MyMandate[] }>('/api/me/mandates')).data.mandates);
    } catch (e) {
      setMsg({ ok: false, text: `Could not load your mandates: ${(e as Error).message}` });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/me/mandates/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
      setMsg({ ok: true, text: 'Mandate revoked. Your agent can no longer shop or pay with it.' });
      setConfirming(null);
      void load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      id="mandates"
      title="My mandates"
      subtitle="The limits you signed for your agent. Revoke one to stop any further purchase with it; orders already paid stay as they are."
    >
      {!mandates && !msg && <Skeleton height={80} label="Loading your mandates" />}
      {mandates && mandates.length === 0 && (
        <p className={u.muted}>
          No mandates yet. <Link href="/buyer">Start shopping</Link> to create one.
        </p>
      )}
      {mandates && mandates.length > 0 && (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead>
              <tr>
                <th scope="col">What you asked for</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Budget
                </th>
                <th scope="col">Status</th>
                <th scope="col">Orders</th>
                <th scope="col">Signed</th>
                <th scope="col">
                  <span className={u.srOnly}>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {mandates.map((m) => (
                <tr key={m.mandate_id}>
                  <td>{m.request_text ?? <span className={u.mono}>{m.mandate_id}</span>}</td>
                  <td className={u.num}>{formatMoney(m.max_total.value, m.max_total.currency)}</td>
                  <td>
                    <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].text}</Badge>
                    {m.status === 'active' && <div className={u.muted}>until {formatDateTime(m.expires_at)}</div>}
                  </td>
                  <td className={u.num}>{m.orders}</td>
                  <td className={u.muted}>{formatDateTime(m.created_at)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {m.status === 'active' &&
                      (confirming === m.mandate_id ? (
                        <span className={u.row} style={{ gap: '0.4rem', justifyContent: 'flex-end' }}>
                          <button className={u.btn} type="button" disabled={busy} onClick={() => revoke(m.mandate_id)}>
                            {busy ? 'Revoking…' : 'Yes, revoke'}
                          </button>
                          <button className={`${u.btn} ${u.btnSecondary}`} type="button" disabled={busy} onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button className={`${u.btn} ${u.btnSecondary}`} type="button" onClick={() => setConfirming(m.mandate_id)}>
                          Revoke
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && (
        <div style={{ marginTop: '0.75rem' }}>
          <Notice tone={msg.ok ? 'good' : 'bad'} alert={!msg.ok}>
            {msg.text}
          </Notice>
        </div>
      )}
    </Card>
  );
}

export default function AccountPage() {
  return (
    <>
      <PageHeader title="Your account" subtitle="Your orders, your mandates, your sign-in, and your data." />
      <div style={{ display: 'grid', gap: '1rem' }}>
        <MyOrdersCard />
        <MandatesCard />
        <PayPalCard />
        <ProfileCard />
        <PasswordCard />
        <SessionsCard />
        <Card title="Your data" subtitle="Everything stored about you: account, mandates, carts and orders.">
          <a className={`${u.btn} ${u.btnSecondary}`} href="/api/me/export">
            Download my data (JSON)
          </a>
        </Card>
      </div>
    </>
  );
}
