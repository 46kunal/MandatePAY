'use client';
// Account panels shared by the buyer's Account page and the store team's Settings > Security tab:
// name, password, and signed-in devices.
import { useCallback, useEffect, useState } from 'react';
import { authClient, useSession } from '@/lib/auth/client';
import { Card, Notice, Skeleton } from './Ui';
import u from './ui.module.css';

type Msg = { ok: boolean; text: string } | null;

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <Notice tone={msg.ok ? 'good' : 'bad'} alert={!msg.ok}>
      {msg.text}
    </Notice>
  );
}

export function ProfileCard() {
  const { data, refetch } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => setName(data?.user.name ?? ''), [data?.user.name]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await authClient.updateUser({ name: name.trim() });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error.message ?? 'Not saved.' });
    setMsg({ ok: true, text: 'Saved' });
    refetch();
  }

  return (
    <Card title="Profile">
      {!data ? (
        <Skeleton height={60} label="Loading profile" />
      ) : (
        <form onSubmit={save} style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
          <div className={u.field}>
            <label htmlFor="acc-name">Name</label>
            <input id="acc-name" className={u.input} value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
          <div className={u.field}>
            <label htmlFor="acc-email">Email</label>
            <input id="acc-email" className={u.input} value={data.user.email} disabled />
          </div>
          <div className={u.row} style={{ gap: '0.75rem' }}>
            <button className={u.btn} type="submit" disabled={busy || !name.trim() || name.trim() === data.user.name}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
          <Message msg={msg} />
        </form>
      )}
    </Card>
  );
}

export function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 10) return setMsg({ ok: false, text: 'The new password needs at least 10 characters.' });
    setBusy(true);
    setMsg(null);
    const r = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: signOutOthers });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error.message ?? 'Password not changed.' });
    setCurrent('');
    setNext('');
    setMsg({ ok: true, text: signOutOthers ? 'Password changed. Other devices were signed out.' : 'Password changed' });
  }

  return (
    <Card title="Password">
      <form onSubmit={save} style={{ display: 'grid', gap: '0.75rem', maxWidth: 420 }}>
        <div className={u.field}>
          <label htmlFor="pw-current">Current password</label>
          <input id="pw-current" className={u.input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className={u.field}>
          <label htmlFor="pw-new">New password</label>
          <input id="pw-new" className={u.input} type="password" autoComplete="new-password" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
          <span className={u.muted} style={{ fontSize: '0.85em' }}>At least 10 characters.</span>
        </div>
        <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input id="pw-signout" type="checkbox" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} />
          Sign out my other devices
        </label>
        <div>
          <button className={u.btn} type="submit" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </div>
        <Message msg={msg} />
      </form>
    </Card>
  );
}

interface SessionRow {
  id: string;
  token: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  userAgent?: string | null;
  ipAddress?: string | null;
}

/** "Chrome on Windows" from a user agent, without a library. */
function deviceName(ua?: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|node|undici/i.test(ua) ? 'Script' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SessionsCard() {
  const { data: current } = useSession();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    const r = await authClient.listSessions();
    if (r.error) return setMsg({ ok: false, text: r.error.message ?? 'Could not load your devices.' });
    setSessions((r.data ?? []) as SessionRow[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function signOutOthers() {
    setBusy(true);
    setMsg(null);
    const r = await authClient.revokeOtherSessions();
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error.message ?? 'Could not sign out other devices.' });
    setMsg({ ok: true, text: 'Other devices signed out' });
    void load();
  }

  const currentToken = current?.session.token;
  const others = sessions?.filter((s) => s.token !== currentToken).length ?? 0;

  return (
    <Card title="Signed-in devices" subtitle="Each place your account is signed in. Sessions last 7 days.">
      {!sessions && !msg && <Skeleton height={60} label="Loading devices" />}
      {sessions && (
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'grid', gap: '0.35rem' }}>
            {sessions.map((s) => (
              <li key={s.id}>
                {deviceName(s.userAgent)}
                {s.token === currentToken && <strong> · this device</strong>}
                <span className={u.muted}> · last active {new Date(s.updatedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <div>
            <button className={`${u.btn} ${u.btnSecondary}`} type="button" onClick={signOutOthers} disabled={busy || others === 0}>
              {others === 0 ? 'No other devices' : `Sign out ${others} other device${others === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
      <Message msg={msg} />
    </Card>
  );
}

/** The PayPal account linked to this MandatePay account: connect, check, disconnect. */
export function PayPalCard() {
  const { data, refetch } = useSession();
  const [linked, setLinked] = useState<boolean | null>(null);
  const [paypalAccountId, setPaypalAccountId] = useState<string | null>(null);
  const [onlySignIn, setOnlySignIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const enabled = process.env.NEXT_PUBLIC_PAYPAL_LOGIN_ENABLED === '1';

  const load = useCallback(async () => {
    const r = await authClient.listAccounts();
    if (r.error) return setMsg({ ok: false, text: r.error.message ?? 'Could not read your sign-in methods.' });
    const accounts = (r.data ?? []) as { providerId: string; accountId: string }[];
    const providers = accounts.map((a) => a.providerId);
    setPaypalAccountId(accounts.find((a) => a.providerId === 'paypal')?.accountId ?? null);
    setLinked(providers.includes('paypal'));
    setOnlySignIn(providers.length === 1 && providers[0] === 'paypal');
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function connect() {
    setBusy(true);
    setMsg(null);
    const r = await authClient.linkSocial({ provider: 'paypal', callbackURL: window.location.pathname });
    if (r?.error) {
      setMsg({ ok: false, text: r.error.message ?? 'Could not start connecting PayPal.' });
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!paypalAccountId) return;
    setBusy(true);
    setMsg(null);
    const r = await authClient.unlinkAccount({ accountId: paypalAccountId });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error.message ?? 'Could not disconnect PayPal.' });
    setMsg({ ok: true, text: 'PayPal disconnected' });
    refetch();
    void load();
  }

  const user = data?.user as { paypalPayerId?: string | null; paypalVerified?: boolean | null } | undefined;
  return (
    <Card
      id="paypal"
      title="PayPal account"
      subtitle="Connecting PayPal lets the store match your payments to you, which strengthens your side if a payment is ever disputed."
    >
      {linked === null && !msg && <Skeleton height={40} label="Checking PayPal" />}
      {linked === true && (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          <p style={{ margin: 0 }}>
            Connected.{' '}
            {user?.paypalPayerId
              ? user.paypalVerified
                ? 'PayPal says this account is verified.'
                : 'PayPal says this account is not verified yet.'
              : 'PayPal did not share the account details; reconnect to try again.'}
          </p>
          <div>
            {onlySignIn ? (
              <span className={u.muted}>You sign in with PayPal only, so it cannot be disconnected.</span>
            ) : (
              <button className={`${u.btn} ${u.btnSecondary}`} type="button" onClick={disconnect} disabled={busy}>
                Disconnect PayPal
              </button>
            )}
          </div>
        </div>
      )}
      {linked === false &&
        (enabled ? (
          <button className={u.btn} type="button" onClick={connect} disabled={busy}>
            {busy ? 'Opening PayPal…' : 'Connect PayPal'}
          </button>
        ) : (
          <p className={u.muted} style={{ margin: 0 }}>
            Connecting PayPal is not switched on for this store yet.
          </p>
        ))}
      <Message msg={msg} />
    </Card>
  );
}
