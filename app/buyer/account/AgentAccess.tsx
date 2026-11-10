'use client';
// OWNER: C. "Agent access": the buyer makes keys so an outside AI agent (over MCP) can shop for them inside the mandates
// they already signed. A key is shown once. The agent can never sign a mandate or pay: the buyer approves in PayPal.
import { useCallback, useEffect, useState } from 'react';
import type { ApiKeyView } from '@/contracts/schemas';
import { apiFetch } from '../../_ui/api';
import { formatDateTime } from '../../_ui/labels';
import { Badge, Card, Notice, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';

export function AgentAccessCard() {
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp';

  const load = useCallback(async () => {
    try {
      setKeys((await apiFetch<{ keys: ApiKeyView[] }>('/api/me/keys')).data.keys);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ key: string; name: string }>('/api/me/keys', { body: { name } });
      setFresh({ key: r.data.key, name: r.data.name });
      setName('');
      void load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/api/me/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setMsg({ ok: true, text: 'Key revoked. Any agent using it is cut off.' });
      void load();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const active = keys?.filter((k) => !k.revoked_at) ?? [];

  return (
    <Card
      id="agents"
      title="Agent access"
      subtitle="Let an AI agent you trust shop for you, but only inside the mandates you have signed. It can never sign one or pay: you approve every payment in PayPal."
    >
      <form onSubmit={create} className={u.row} style={{ gap: 12, flexWrap: 'wrap' }}>
        <label className={u.srOnly} htmlFor="key-name">
          Name for the key
        </label>
        <input id="key-name" className={u.input} style={{ maxWidth: 280 }} placeholder="Name, for example My assistant" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={busy} />
        <button className={u.btn} type="submit" disabled={busy || name.trim() === '' || active.length >= 5}>
          Create a key
        </button>
        {active.length >= 5 && <span className={u.muted}>You have 5 active keys. Revoke one to make another.</span>}
      </form>

      {fresh && (
        <div style={{ marginTop: 16 }}>
          <Notice tone="warn">
            <strong>Copy this key now.</strong> It is shown only once, and anyone who has it can use your signed mandates to place orders you then approve.
            <div className={u.mono} style={{ margin: '8px 0', userSelect: 'all' }}>
              {fresh.key}
            </div>
            <button
              className={`${u.btn} ${u.btnSecondary}`}
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.key).then(() => setCopied(true));
              }}
            >
              {copied ? 'Copied' : 'Copy key'}
            </button>
            <p style={{ margin: '12px 0 4px' }}>Connect it, for example in Claude Code:</p>
            <div className={u.mono} style={{ userSelect: 'all' }}>
              claude mcp add --transport http mandatepay {endpoint} --header &quot;Authorization: Bearer {fresh.key}&quot;
            </div>
          </Notice>
        </div>
      )}

      {msg && (
        <div style={{ marginTop: 16 }}>
          <Notice tone={msg.ok ? 'good' : 'bad'} alert={!msg.ok}>
            {msg.text}
          </Notice>
        </div>
      )}

      {!keys && !msg && <Skeleton height={64} label="Loading your keys" />}
      {keys && keys.length > 0 && (
        <div className={u.tableWrap} style={{ marginTop: 16 }}>
          <table className={u.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Key</th>
                <th scope="col">Created</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className={u.srOnly}>Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td className={u.mono}>{k.prefix}…</td>
                  <td className={`${u.muted} ${u.nowrap}`}>{formatDateTime(k.created_at)}</td>
                  <td className={`${u.muted} ${u.nowrap}`}>{k.last_used_at ? formatDateTime(k.last_used_at) : 'Never'}</td>
                  <td style={{ textAlign: 'right' }}>
                    {k.revoked_at ? (
                      <Badge tone="neutral">Revoked</Badge>
                    ) : (
                      <button className={u.linkButton} type="button" onClick={() => revoke(k.id)} disabled={busy}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
