'use client';
// Admin console: every account (search, role, sign-in on or off), live system health, and the audit log.
import { useCallback, useEffect, useState } from 'react';
import type { AccountSummary } from '@/contracts/schemas';
import { useSession } from '@/lib/auth/client';
import { apiFetch } from '../_ui/api';
import { formatDateTime } from '../_ui/labels';
import { Badge, Card, Notice, PageHeader, Skeleton } from '../_ui/Ui';
import u from '../_ui/ui.module.css';
import { AuditTable } from '../merchant/settings/sections';

interface Health {
  checked_at: string;
  checks: { name: string; ok: boolean; detail: string }[];
}

function HealthCard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setHealth((await apiFetch<Health>('/api/admin/health')).data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      id="health"
      title="System health"
      subtitle={health ? `Checked ${formatDateTime(health.checked_at)}` : 'Live checks; nothing secret is shown.'}
      actions={
        <button className={`${u.btn} ${u.btnSecondary}`} type="button" onClick={load} disabled={busy}>
          {busy ? 'Checking…' : 'Check again'}
        </button>
      }
    >
      {error && (
        <Notice tone="bad" alert>
          Could not run the checks: {error}
        </Notice>
      )}
      {!health && !error && <Skeleton height={120} label="Running checks" />}
      {health && (
        <dl className={u.kv}>
          {health.checks.map((c) => (
            <div key={c.name} style={{ display: 'contents' }}>
              <dt>{c.name}</dt>
              <dd>
                {c.ok ? <Badge tone="good">OK</Badge> : <Badge tone="bad">Problem</Badge>} <span className={u.muted}>{c.detail}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

const ROLES = ['buyer', 'staff', 'owner', 'admin'] as const;
const ROLE_WORD: Record<string, string> = { buyer: 'Buyer', staff: 'Staff', owner: 'Owner', admin: 'Admin' };

function UsersCard() {
  const { data: session } = useSession();
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AccountSummary[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (query: string) => {
    try {
      const r = await apiFetch<{ users: AccountSummary[] }>(`/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      setUsers(r.data.users);
    } catch (e) {
      setMsg({ ok: false, text: `Could not load accounts: ${(e as Error).message}` });
    }
  }, []);
  useEffect(() => {
    void load('');
  }, [load]);

  async function update(user: AccountSummary, change: { role?: string; disabled?: boolean }) {
    setBusyId(user.id);
    setMsg(null);
    try {
      await apiFetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: change });
      const what =
        change.role !== undefined
          ? `${user.email} is now ${ROLE_WORD[change.role] ?? change.role}.`
          : change.disabled
            ? `${user.email} can no longer sign in, and was signed out everywhere.`
            : `${user.email} can sign in again.`;
      setMsg({ ok: true, text: what });
      void load(q);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card id="users" title="Accounts" subtitle="Everyone who has signed up. Changes are recorded in the audit log.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(q.trim());
        }}
        className={u.row}
        style={{ gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}
      >
        <label htmlFor="admin-q" className={u.srOnly}>
          Search accounts
        </label>
        <input id="admin-q" className={u.input} style={{ maxWidth: 320 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
        <button className={`${u.btn} ${u.btnSecondary}`} type="submit">
          Search
        </button>
      </form>
      {!users && !msg && <Skeleton height={120} label="Loading accounts" />}
      {users && users.length === 0 && <p className={u.muted}>No accounts match.</p>}
      {users && users.length > 0 && (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Sign-in</th>
                <th scope="col">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map((a) => {
                const self = a.id === session?.user.id;
                const busy = busyId === a.id;
                return (
                  <tr key={a.id}>
                    <td>
                      {a.name}
                      {self && <span className={u.muted}> (you)</span>}
                    </td>
                    <td>{a.email}</td>
                    <td>
                      <label htmlFor={`role-${a.id}`} className={u.srOnly}>
                        Role for {a.email}
                      </label>
                      <select
                        id={`role-${a.id}`}
                        className={u.input}
                        value={a.role}
                        disabled={self || busy}
                        onChange={(e) => update(a, { role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_WORD[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {self ? (
                        <span className={u.muted}>On</span>
                      ) : (
                        <button
                          className={`${u.btn} ${u.btnSecondary}`}
                          type="button"
                          disabled={busy}
                          onClick={() => update(a, { disabled: !a.disabled })}
                        >
                          {a.disabled ? 'Turn on' : 'Turn off'}
                        </button>
                      )}
                      {a.disabled && <div className={u.muted}>Off</div>}
                    </td>
                    <td className={u.muted}>{formatDateTime(a.created_at)}</td>
                  </tr>
                );
              })}
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

export default function AdminPage() {
  const { data, isPending } = useSession();
  const role = (data?.user as { role?: string } | undefined)?.role;
  if (!isPending && role !== 'admin') {
    return (
      <>
        <PageHeader title="Admin" />
        <Notice tone="warn">The admin console is for admin accounts only.</Notice>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Admin" subtitle="Accounts, system health and the audit log." />
      <div style={{ display: 'grid', gap: '1rem' }}>
        <HealthCard />
        <UsersCard />
        <Card id="audit" title="Audit log" subtitle="Who changed what, newest first.">
          <AuditTable />
        </Card>
      </div>
    </>
  );
}
