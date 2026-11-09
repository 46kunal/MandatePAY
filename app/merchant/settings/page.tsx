'use client';
// OWNER: C. Settings, in tabs. The tab is in the URL hash (#store, #connections, #team, #security, #data) so it can be
// linked. Store and rules: GET/PATCH /api/settings (owner edits, staff read). The other tabs are in ./sections.tsx;
// Security is the signed-in person's own name, password and devices.
import { useEffect, useState } from 'react';
import type { StoreSettings } from '@/contracts/schemas';
import { useSession } from '@/lib/auth/client';
import { can } from '@/lib/auth/roles';
import { PasswordCard, ProfileCard, SessionsCard } from '../../_ui/AccountPanels';
import { apiFetch } from '../../_ui/api';
import { Card, Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';
import { ConnectionsCard, DataCard, TeamCard } from './sections';

type Draft = { store_name: string; support_email: string; approval_threshold: string; human_review_over: string; min_confidence: string };

const toDraft = (s: StoreSettings): Draft => ({
  store_name: s.store_name ?? '',
  support_email: s.support_email ?? '',
  approval_threshold: s.approval_threshold,
  human_review_over: s.human_review_over,
  min_confidence: String(Math.round(s.min_confidence * 100)),
});

/** Turn what was typed into a PATCH body, or a message saying what to fix. */
function toPatch(d: Draft): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  const money = /^\d+(\.\d{1,2})?$/;
  for (const [k, label] of [['approval_threshold', 'Approval limit'], ['human_review_over', 'Human review over']] as const) {
    if (!money.test(d[k].trim())) return { ok: false, message: `${label} must be an amount like 100 or 99.50.` };
  }
  const pct = Number(d.min_confidence);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { ok: false, message: 'Minimum confidence must be between 0 and 100.' };
  return {
    ok: true,
    body: {
      store_name: d.store_name.trim() || null,
      support_email: d.support_email.trim() || null,
      approval_threshold: Number(d.approval_threshold).toFixed(2),
      human_review_over: Number(d.human_review_over).toFixed(2),
      min_confidence: Math.round(pct) / 100,
    },
  };
}

function StoreSettingsCard() {
  const { data: session } = useSession();
  const canEdit = can((session?.user as { role?: string } | undefined)?.role, 'settings:write');
  const [saved, setSaved] = useState<StoreSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<StoreSettings>('/api/settings')
      .then((r) => {
        setSaved(r.data);
        setDraft(toDraft(r.data));
      })
      .catch((e: Error) => setMsg({ ok: false, text: `Could not load settings: ${e.message}` }));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const p = toPatch(draft);
    if (!p.ok) return setMsg({ ok: false, text: p.message });
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<StoreSettings>('/api/settings', { method: 'PATCH', body: p.body });
      setSaved(r.data);
      setDraft(toDraft(r.data));
      setMsg({ ok: true, text: 'Saved' });
    } catch (err) {
      setMsg({ ok: false, text: `Not saved: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Draft, label: string, hint: string, type = 'text', placeholder?: string) => (
    <div className={u.field}>
      <label htmlFor={`s-${key}`}>{label}</label>
      <input
        id={`s-${key}`}
        className={u.input}
        type={type}
        inputMode={type === 'text' && key !== 'store_name' && key !== 'support_email' ? 'decimal' : undefined}
        value={draft?.[key] ?? ''}
        placeholder={placeholder}
        onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))}
        disabled={!draft || busy || !canEdit}
      />
      <span className={u.muted} style={{ fontSize: '0.85em' }}>{hint}</span>
    </div>
  );

  return (
    <Card id="store" title="Store and rules" subtitle="Changes apply to new carts and new dispute analyses.">
      {!draft && !msg && <Skeleton height={120} label="Loading settings" />}
      {draft && (
        <form onSubmit={save} style={{ display: 'grid', gap: '0.9rem' }}>
          <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {field('store_name', 'Store name', 'Shown on carts, receipts and evidence.', 'text', 'Your store')}
            {field('support_email', 'Support email', 'Optional. Shown to buyers.', 'email', 'help@yourstore.com')}
            {field('approval_threshold', 'Approval limit (USD)', 'Carts above this need the buyer to approve, unless their mandate sets a limit.')}
            {field('human_review_over', 'Human review over (USD)', 'Disputes at or above this always need a person.')}
            {field('min_confidence', 'Minimum AI confidence (%)', 'AI verdicts below this need a person.')}
          </div>
          <div className={u.row} style={{ gap: '0.75rem' }}>
            {canEdit ? (
              <button className={u.btn} type="submit" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <span className={u.muted}>Only the store owner can change these.</span>
            )}
            {saved?.updated_at ? (
              <span className={u.muted}>Last saved {new Date(saved.updated_at).toLocaleString()}</span>
            ) : (
              <span className={u.muted}>Using the defaults from the server environment</span>
            )}
          </div>
        </form>
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

const TABS = [
  { id: 'store', label: 'Store and rules' },
  { id: 'connections', label: 'Connections' },
  { id: 'team', label: 'Team' },
  { id: 'security', label: 'Security' },
  { id: 'data', label: 'Data' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function tabFromHash(): TabId {
  const h = window.location.hash.slice(1);
  return TABS.find((t) => t.id === h)?.id ?? 'store';
}

export default function SettingsPage() {
  const [tab, setTab] = useState<TabId>('store');
  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return (
    <>
      <PageHeader title="Settings" subtitle="Your store, its team, and your own account." />
      <div role="tablist" aria-label="Settings sections" className={u.row} style={{ gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {TABS.map((t) => (
          <a
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            href={`#${t.id}`}
            className={`${u.btn} ${tab === t.id ? '' : u.btnSecondary}`}
          >
            {t.label}
          </a>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} style={{ display: 'grid', gap: '1rem' }}>
        {tab === 'store' && <StoreSettingsCard />}
        {tab === 'connections' && <ConnectionsCard />}
        {tab === 'team' && <TeamCard />}
        {tab === 'security' && (
          <>
            <ProfileCard />
            <PasswordCard />
            <SessionsCard />
          </>
        )}
        {tab === 'data' && <DataCard />}
      </div>
    </>
  );
}
