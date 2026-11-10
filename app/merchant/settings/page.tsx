'use client';
// OWNER: C. Settings. A section list on the left (the section is in the URL hash, so it can be linked) and the content
// on the right. Store profile and rules share one draft and one save bar that appears only when something changed.
// Store and rules: GET/PATCH /api/settings (owner edits, staff read). The other sections are in ./sections.tsx;
// Security is the signed-in person's own name, password and devices.
import { useEffect, useMemo, useState } from 'react';
import type { StoreSettings } from '@/contracts/schemas';
import { useSession } from '@/lib/auth/client';
import { can } from '@/lib/auth/roles';
import { PasswordCard, ProfileCard, SessionsCard } from '../../_ui/AccountPanels';
import { apiFetch } from '../../_ui/api';
import { Icon, type IconName } from '../../_ui/Icons';
import { Notice, PageHeader, Skeleton } from '../../_ui/Ui';
import u from '../../_ui/ui.module.css';
import { ConnectionsCard, DataCard, TeamCard } from './sections';
import t from './settings.module.css';

type Draft = {
  store_name: string;
  support_email: string;
  approval_threshold: string;
  human_review_over: string;
  min_confidence: string;
  auto_analyse: boolean;
};

const toDraft = (s: StoreSettings): Draft => ({
  store_name: s.store_name ?? '',
  support_email: s.support_email ?? '',
  approval_threshold: s.approval_threshold,
  human_review_over: s.human_review_over,
  min_confidence: String(Math.round(s.min_confidence * 100)),
  auto_analyse: s.auto_analyse,
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
      auto_analyse: d.auto_analyse,
    },
  };
}

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'store' },
  { id: 'rules', label: 'Rules and automation', icon: 'shield' },
  { id: 'connections', label: 'Connections', icon: 'spark' },
  { id: 'team', label: 'Team', icon: 'user' },
  { id: 'security', label: 'Security', icon: 'lock' },
  { id: 'data', label: 'Data', icon: 'file' },
];
const LEGACY: Record<string, string> = { store: 'general' };

function sectionFromHash(): string {
  const h = window.location.hash.slice(1);
  const id = LEGACY[h] ?? h;
  return SECTIONS.find((s) => s.id === id)?.id ?? 'general';
}

function Setting({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className={t.setting}>
      <div>
        <label className={t.label} htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <span className={t.hint}>{hint}</span>}
      </div>
      <div className={t.control}>{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const canEdit = can((session?.user as { role?: string } | undefined)?.role, 'settings:write');
  const [section, setSection] = useState('general');
  const [saved, setSaved] = useState<StoreSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const sync = () => setSection(sectionFromHash());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    apiFetch<StoreSettings>('/api/settings')
      .then((r) => {
        setSaved(r.data);
        setDraft(toDraft(r.data));
      })
      .catch((e: Error) => setMsg({ ok: false, text: `Could not load settings: ${e.message}` }));
  }, []);

  const dirty = useMemo(() => Boolean(saved && draft && JSON.stringify(toDraft(saved)) !== JSON.stringify(draft)), [saved, draft]);

  async function save() {
    if (!draft) return;
    const p = toPatch(draft);
    if (!p.ok) return setMsg({ ok: false, text: p.message });
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<StoreSettings>('/api/settings', { method: 'PATCH', body: p.body });
      setSaved(r.data);
      setDraft(toDraft(r.data));
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setMsg({ ok: false, text: `Not saved: ${(err as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));
  const disabled = !draft || busy || !canEdit;

  const body = !draft ? (
    <Skeleton height={160} label="Loading settings" />
  ) : section === 'general' ? (
    <section className={t.block}>
      <h2>General</h2>
      <p>How your store appears to buyers.</p>
      <div className={t.panel}>
        <Setting label="Store name" hint="Shown on carts, receipts and evidence." htmlFor="s-name">
          <input id="s-name" className={u.input} value={draft.store_name} onChange={(e) => set('store_name', e.target.value)} placeholder="Your store" disabled={disabled} />
        </Setting>
        <Setting label="Support email" hint="Optional. Buyers can reach you here." htmlFor="s-email">
          <input id="s-email" className={u.input} type="email" value={draft.support_email} onChange={(e) => set('support_email', e.target.value)} placeholder="help@yourstore.com" disabled={disabled} />
        </Setting>
      </div>
      {!canEdit && <p style={{ margin: '0.75rem 0 0' }} className={u.muted}>Only the store owner can change these.</p>}
    </section>
  ) : section === 'rules' ? (
    <section className={t.block}>
      <h2>Rules and automation</h2>
      <p>When a person must step in, and what the AI does on its own. Changes apply to new carts and new analyses.</p>
      <div className={t.panel}>
        <Setting label="Approval limit" hint="Carts above this need the buyer to approve, unless their mandate sets a limit." htmlFor="s-approval">
          <div className={t.suffix}>
            <input id="s-approval" className={u.input} inputMode="decimal" value={draft.approval_threshold} onChange={(e) => set('approval_threshold', e.target.value)} disabled={disabled} />
            <span>USD</span>
          </div>
        </Setting>
        <Setting label="Human review over" hint="Disputes at or above this amount always need a person." htmlFor="s-review">
          <div className={t.suffix}>
            <input id="s-review" className={u.input} inputMode="decimal" value={draft.human_review_over} onChange={(e) => set('human_review_over', e.target.value)} disabled={disabled} />
            <span>USD</span>
          </div>
        </Setting>
        <Setting label="Minimum AI confidence" hint="AI recommendations below this need a person." htmlFor="s-conf">
          <div className={t.suffix}>
            <input id="s-conf" className={u.input} inputMode="numeric" value={draft.min_confidence} onChange={(e) => set('min_confidence', e.target.value)} disabled={disabled} />
            <span>%</span>
          </div>
        </Setting>
        <Setting label="Analyse new disputes automatically" hint="As soon as a dispute arrives, the AI reads it (at most 3 at a time). Nothing is sent to PayPal until a person approves.">
          <label className={t.switch}>
            <input type="checkbox" role="switch" checked={draft.auto_analyse} onChange={(e) => set('auto_analyse', e.target.checked)} disabled={disabled} aria-label="Analyse new disputes automatically" />
            <span className={t.track} />
          </label>
        </Setting>
      </div>
      {!canEdit && <p style={{ margin: '0.75rem 0 0' }} className={u.muted}>Only the store owner can change these.</p>}
    </section>
  ) : section === 'connections' ? (
    <ConnectionsCard />
  ) : section === 'team' ? (
    <TeamCard />
  ) : section === 'security' ? (
    <>
      <ProfileCard />
      <PasswordCard />
      <SessionsCard />
    </>
  ) : (
    <DataCard />
  );

  return (
    <>
      <PageHeader title="Settings" subtitle="Your store, its team, and your own account." />
      <div className={t.layout}>
        <nav className={t.side} aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={`${t.sideLink} ${section === s.id ? t.sideOn : ''}`} aria-current={section === s.id ? 'page' : undefined}>
              <Icon name={s.icon} />
              {s.label}
            </a>
          ))}
        </nav>
        <div className={t.content}>
          {msg && (
            <Notice tone={msg.ok ? 'good' : 'bad'} alert={!msg.ok}>
              {msg.text}
            </Notice>
          )}
          {body}
        </div>
      </div>
      {canEdit && (dirty || justSaved) && (
        <div className={t.saveBar} role="status">
          {justSaved && !dirty ? (
            <span className={t.saved}>✓ Changes saved</span>
          ) : (
            <>
              <span>You have unsaved changes</span>
              <button type="button" className={t.discard} onClick={() => saved && setDraft(toDraft(saved))} disabled={busy}>
                Discard
              </button>
              <button type="button" className={t.save} onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
