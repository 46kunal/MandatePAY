'use client';
// OWNER: C. Page frames: BuyerShell (simple top bar) and MerchantShell (sidebar), plus the demo-mode bar.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import u from './ui.module.css';

interface DemoStatus {
  demo: boolean;
  paypal_configured: boolean;
  llm_provider: string;
}

/** Shown only when the server runs with DEMO_MODE=true. Offers a one-click reset of the demo data. */
export function DemoBar() {
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
          {status.llm_provider === 'mock' ? 'sample AI analyst' : `AI analyst: ${status.llm_provider}`}
        </span>
        <span className={u.demoActions}>
          {error && <span>{error}</span>}
          <button className={u.demoBtn} onClick={reset} disabled={busy}>
            {busy ? 'Resetting…' : 'Reset demo data'}
          </button>
        </span>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className={u.brand}>
      <span className={u.brandMark} aria-hidden="true">
        M
      </span>
      MandatePay
    </Link>
  );
}

export function BuyerShell({ children }: { children: ReactNode }) {
  return (
    <div className={u.root}>
      <header className={u.topbar}>
        <div className={u.topbarInner}>
          <Brand />
          <Link href="/merchant" className={u.topLink}>
            Merchant dashboard →
          </Link>
        </div>
      </header>
      <DemoBar />
      <main className={u.contentNarrow}>{children}</main>
    </div>
  );
}

const NAV = [
  { href: '/merchant', label: 'Overview', exact: true },
  { href: '/merchant/disputes', label: 'Disputes' },
  { href: '/merchant/orders', label: 'Orders' },
  { href: '/merchant/ledger', label: 'Mandate ledger' },
  { href: '/merchant/evidence', label: 'Evidence reports' },
  { href: '/merchant/settings', label: 'Settings' },
];

export function MerchantShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '';
  return (
    <div className={u.root}>
      <div className={u.app}>
        <aside className={u.sidebar}>
          <Brand />
          <nav aria-label="Merchant" className={u.navWrap}>
            <ul className={u.navList}>
              {NAV.map((n) => {
                const on = n.exact ? path === n.href : path === n.href || path.startsWith(n.href + '/');
                return (
                  <li key={n.href}>
                    <Link href={n.href} className={`${u.navItem} ${on ? u.navOn : ''}`} aria-current={on ? 'page' : undefined}>
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className={u.navFoot}>
            Shopping as a buyer? <Link href="/buyer">Open the buyer view</Link>
          </div>
        </aside>
        <div className={u.main}>
          <DemoBar />
          <main className={u.content}>{children}</main>
        </div>
      </div>
    </div>
  );
}
