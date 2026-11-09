'use client';
// OWNER: C. Page frames: BuyerShell (simple top bar) and MerchantShell (sidebar).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import u from './ui.module.css';

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
      <main className={u.contentNarrow}>{children}</main>
    </div>
  );
}

const NAV = [
  { href: '/merchant', label: 'Overview', exact: true },
  { href: '/merchant/disputes', label: 'Disputes' },
  { href: '/merchant/products', label: 'Products' },
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
              <main className={u.content}>{children}</main>
        </div>
      </div>
    </div>
  );
}
