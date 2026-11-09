'use client';
// OWNER: C. Page frame with the top bar and Buyer / Merchant tabs, the demo-mode bar, and a small Badge.
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { Tone } from './labels';
import u from './ui.module.css';

interface DemoStatus {
  demo: boolean;
  paypal_configured: boolean;
  llm_provider: string;
}

/** Shown only when the server runs with DEMO_MODE=true. Offers a one-click reset of the demo data. */
function DemoBar() {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetch('/api/demo/status', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: DemoStatus | null) => setStatus(s))
      .catch(() => undefined);
    return () => ctl.abort();
  }, []);

  if (!status?.demo) return null;

  async function reset() {
    if (!window.confirm('Reset the demo? This replaces all current data with the sample disputes.')) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/demo/reset', { method: 'POST' });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Reset failed (${r.status})`);
      }
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
      setBusy(false);
    }
  }

  return (
    <div className={u.demoBar} role="status">
      <div className={u.demoInner}>
        <span>
          <strong>Demo mode</strong> · {status.paypal_configured ? 'PayPal sandbox' : 'PayPal simulated'} ·{' '}
          {status.llm_provider === 'mock' ? 'sample AI analyst' : `AI: ${status.llm_provider}`}
        </span>
        <span className={u.demoActions}>
          {error && <span className={u.demoError}>{error}</span>}
          <button className={u.demoBtn} onClick={reset} disabled={busy}>
            {busy ? 'Resetting…' : 'Reset demo'}
          </button>
        </span>
      </div>
    </div>
  );
}

export function Shell({ active, children }: { active: 'buyer' | 'merchant'; children: ReactNode }) {
  const tab = (key: 'buyer' | 'merchant', href: string, label: string) => (
    <Link
      href={href}
      className={`${u.tab} ${active === key ? u.tabOn : ''}`}
      aria-current={active === key ? 'page' : undefined}
    >
      {label}
    </Link>
  );
  return (
    <div className={u.shell}>
      <header className={u.bar}>
        <div className={u.barInner}>
          <Link href="/" className={u.brand}>
            Mandate<span>Pay</span>
          </Link>
          <nav className={u.tabs} aria-label="Main">
            {tab('buyer', '/buyer', 'Buyer')}
            {tab('merchant', '/merchant', 'Merchant')}
          </nav>
        </div>
      </header>
      <DemoBar />
      <main className={u.main}>{children}</main>
    </div>
  );
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`${u.badge} ${u[tone]}`}>{children}</span>;
}
