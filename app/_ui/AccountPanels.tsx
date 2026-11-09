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
