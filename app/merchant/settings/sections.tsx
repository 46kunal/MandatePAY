'use client';
// OWNER: C. Settings tabs other than "Store and rules": Connections, Team and Data.
import { useCallback, useEffect, useState } from 'react';
import type { AccountSummary } from '@/contracts/schemas';
import { useSession } from '@/lib/auth/client';
import { can } from '@/lib/auth/roles';
import { apiFetch } from '../../_ui/api';
import { formatDateTime } from '../../_ui/labels';
import { Badge, Card, Notice, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';

interface Status {
  paypal_configured: boolean;
  paypal_button_configured: boolean;
  webhooks_configured: boolean;
  llm_provider: string | null;
  llm_model: string | null;
  llm_configured: boolean;
  merchant_name: string | null;
  last_webhook_at: string | null;
  last_webhook_rejected?: { at: string; error: string } | null;
}

function Row({ ok, label, good, bad }: { ok: boolean; label: string; good: string; bad: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {ok ? <Badge tone="good">Connected</Badge> : <Badge tone="bad">Not set</Badge>} <span className={u.muted}>{ok ? good : bad}</span>
      </dd>
    </>
  );
}

export function ConnectionsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<Status>('/api/status')
      .then((r) => setStatus(r.data))
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) {
    return (
      <Notice tone="bad" alert>
        Could not read the connection status: {error}
      </Notice>
    );
  }
  if (!status) return <Skeleton height={160} label="Loading connection status" />;
  return (
    <Card id="connections" title="Connections" subtitle="Set on the server with environment variables (see .env.example).">
      <dl className={u.kv}>
        <Row
          ok={status.paypal_configured}
          label="PayPal API"
          good="Orders, captures and dispute actions use the PayPal sandbox."
          bad="Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET. Orders and disputes will fail until then."
        />
        <Row
          ok={status.paypal_button_configured}
          label="PayPal button"
          good="Buyers pay with the real PayPal sandbox checkout."
          bad="Set NEXT_PUBLIC_PAYPAL_CLIENT_ID so buyers can pay."
        />
        <Row
          ok={status.webhooks_configured}
          label="Webhooks"
          good={
            status.last_webhook_at
              ? `Dispute updates arrive as PayPal sends them. Last one ${formatDateTime(status.last_webhook_at)}.`
              : status.last_webhook_rejected
                ? `PayPal is calling this store but was refused (${status.last_webhook_rejected.error}) at ${formatDateTime(status.last_webhook_rejected.at)}. Check that PAYPAL_WEBHOOK_ID matches the webhook registered for this app.`
                : 'Dispute updates arrive as PayPal sends them. None received yet.'
          }
          bad="Optional. Without PAYPAL_WEBHOOK_ID, use Check PayPal for new disputes."
        />
        <Row
          ok={status.llm_configured}
          label="AI model"
          good={`Drafting, shopping and dispute analysis use ${status.llm_provider}${status.llm_model ? ` (${status.llm_model})` : ''}.`}
          bad="Set LLM_PROVIDER and LLM_API_KEY. The agent and the analyst cannot run until then."
        />
      </dl>
    </Card>
  );
}

const ROLE_WORD: Record<string, string> = { buyer: 'Buyer', staff: 'Staff', owner: 'Owner', admin: 'Admin' };

export function TeamCard() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canManage = can(role, 'team:manage');
  const [members, setMembers] = useState<AccountSummary[] | null>(null);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState('staff');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setMembers((await apiFetch<{ members: AccountSummary[] }>('/api/team')).data.members);
    } catch (e) {
      setMsg({ ok: false, text: `Could not load the team: ${(e as Error).message}` });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function change(targetEmail: string, to: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<AccountSummary>('/api/team', { method: 'POST', body: { email: targetEmail, role: to } });
      setMsg({
        ok: true,
        text: to === 'buyer' ? `${r.data.email} is no longer on the team.` : `${r.data.email} is now ${ROLE_WORD[to] ?? to}.`,
      });
      setEmail('');
      void load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      id="team"
      title="Team"
      subtitle="Staff work disputes, orders and products. Owners also change settings, approve dispute actions and manage the team."
    >
      {!members && !msg && <Skeleton height={80} label="Loading team" />}
      {members && (
        <div className={u.tableWrap}>
          <table className={u.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                {canManage && (
                  <th scope="col">
                    <span className={u.srOnly}>Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const self = m.id === session?.user.id;
                return (
                  <tr key={m.id}>
                    <td>
                      {m.name}
                      {self && <span className={u.muted}> (you)</span>}
                      {m.disabled && <span className={u.muted}> · sign-in disabled</span>}
                    </td>
                    <td>{m.email}</td>
                    <td>{ROLE_WORD[m.role] ?? m.role}</td>
                    {canManage && (
                      <td style={{ textAlign: 'right' }}>
                        {!self && m.role !== 'admin' && (
                          <button
                            className={`${u.btn} ${u.btnSecondary}`}
                            type="button"
                            disabled={busy}
                            onClick={() => change(m.email, 'buyer')}
                          >
                            Remove from team
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) void change(email.trim(), newRole);
          }}
          style={{ display: 'grid', gap: '0.75rem', marginTop: '1rem' }}
        >
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', alignItems: 'end' }}>
            <div className={u.field}>
              <label htmlFor="team-email">Add someone by email</label>
              <input
                id="team-email"
                className={u.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className={u.field}>
              <label htmlFor="team-role">Role</label>
              <select id="team-role" className={u.input} value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                <option value="staff">Staff</option>
                <option value="owner">Owner</option>
              </select>
            </div>
            <div>
              <button className={u.btn} type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Saving…' : 'Add to team'}
              </button>
            </div>
          </div>
          <span className={u.muted} style={{ fontSize: '0.85em' }}>
            They create their account at /login first, then you add them here.
          </span>
        </form>
      ) : (
        <p className={u.muted} style={{ marginTop: '0.75rem' }}>
          Only the store owner can change the team.
        </p>
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

interface AuditEntry {
  id: string;
  at: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
}

const ACTION_WORD: Record<string, string> = {
  'settings.update': 'Changed store settings',
  'user.role': 'Changed a role',
  'user.disable': 'Disabled an account',
  'user.enable': 'Enabled an account',
  'mandate.revoke': 'Revoked a mandate',
  'case.act': 'Sent a dispute action',
};

function describe(e: AuditEntry): string {
  const d = e.details ?? {};
  if (e.action === 'user.role') return `${String(d.email ?? e.target_id)}: ${String(d.from)} to ${String(d.to)}`;
  if (e.action === 'user.disable' || e.action === 'user.enable') return String(d.email ?? e.target_id);
  if (e.action === 'case.act') return `${e.target_id}: ${String(d.action)}${d.human_approved ? ', approved by a person' : ''}`;
  if (e.action === 'settings.update') {
    return Object.keys((d.changed as Record<string, unknown> | undefined) ?? {})
      .join(', ')
      .replace(/_/g, ' ');
  }
  return e.target_id ?? '';
}

export function AuditTable() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<{ entries: AuditEntry[] }>('/api/audit?limit=100')
      .then((r) => setEntries(r.data.entries))
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) {
    return (
      <Notice tone="bad" alert>
        Could not load the audit log: {error}
      </Notice>
    );
  }
  if (!entries) return <Skeleton height={80} label="Loading audit log" />;
  if (entries.length === 0) return <p className={u.muted}>Nothing recorded yet.</p>;
  return (
    <div className={u.tableWrap}>
      <table className={u.table}>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">What</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td className={u.muted}>{formatDateTime(e.at)}</td>
              <td>{e.actor_email ?? 'System'}</td>
              <td>{ACTION_WORD[e.action] ?? e.action}</td>
              <td className={u.muted}>{describe(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DataCard() {
  const { data: session } = useSession();
  const canAudit = can((session?.user as { role?: string } | undefined)?.role, 'audit:read');
  return (
    <>
      <Card id="exports" title="Export" subtitle="Spreadsheet files (CSV) of everything recorded so far.">
        <div className={u.row} style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
          <a className={`${u.btn} ${u.btnSecondary}`} href="/api/export/orders">
            Download orders
          </a>
          <a className={`${u.btn} ${u.btnSecondary}`} href="/api/export/disputes">
            Download disputes
          </a>
        </div>
      </Card>
      <Card id="audit" title="Audit log" subtitle="Who changed what, newest first. Entries cannot be edited or deleted.">
        {canAudit ? <AuditTable /> : <p className={u.muted}>Only the store owner can read the audit log.</p>}
      </Card>
    </>
  );
}
