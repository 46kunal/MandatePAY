'use client';
// OWNER: C. Page frames: BuyerShell (simple top bar) and MerchantShell (sidebar).
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { authClient, useSession } from '@/lib/auth/client';
import { isMerchantRole } from '@/lib/auth/roles';
import { Notice } from './Ui';
import u from './ui.module.css';

const ROLE_LABEL: Record<string, string> = { buyer: 'Buyer', staff: 'Staff', owner: 'Owner', admin: 'Admin' };

/** Who is signed in, with Sign out. */
function UserBox({ after }: { after: string }) {
  const { data } = useSession();
  const router = useRouter();
  if (!data?.user) return null;
  const role = (data.user as { role?: string }).role ?? 'buyer';
  return (
    <div className={u.userBox}>
      <span>
        <span className={u.userName}>{data.user.name}</span> <span className={u.muted}>· {ROLE_LABEL[role] ?? role}</span>
      </span>
      <button
        type="button"
        className={u.linkButton}
        onClick={async () => {
          await authClient.signOut();
          router.replace(after);
          router.refresh();
        }}
      >
        Sign out
      </button>
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
          <BuyerTopRight />
        </div>
      </header>
      <main className={u.contentNarrow}>{children}</main>
    </div>
  );
}

function BuyerTopRight() {
  const { data } = useSession();
  const role = (data?.user as { role?: string } | undefined)?.role;
  return (
    <div className={u.userBox}>
      {isMerchantRole(role) && (
        <Link href="/merchant" className={u.topLink}>
          Merchant dashboard →
        </Link>
      )}
      <Link href="/buyer/account" className={u.topLink}>
        Account
      </Link>
      <UserBox after="/login" />
    </div>
  );
}

const NAV: { href: string; label: string; exact?: boolean; adminOnly?: boolean }[] = [
  { href: '/merchant', label: 'Overview', exact: true },
  { href: '/merchant/disputes', label: 'Disputes' },
  { href: '/merchant/products', label: 'Products' },
  { href: '/merchant/orders', label: 'Orders' },
  { href: '/merchant/ledger', label: 'Mandate ledger' },
  { href: '/merchant/evidence', label: 'Evidence reports' },
  { href: '/merchant/settings', label: 'Settings' },
  { href: '/admin', label: 'Admin', adminOnly: true },
];

export function MerchantShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '';
  const { data, isPending } = useSession();
  // The sign-in page has no sidebar.
  if (path === '/merchant/login') return <div className={u.root}>{children}</div>;
  const role = (data?.user as { role?: string } | undefined)?.role;
  const blocked = !isPending && data?.user && !isMerchantRole(role);
  return (
    <div className={u.root}>
      <div className={u.app}>
        <aside className={u.sidebar}>
          <Brand />
          <nav aria-label="Merchant" className={u.navWrap}>
            <ul className={u.navList}>
              {NAV.filter((n) => !n.adminOnly || role === 'admin').map((n) => {
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
          <div className={u.navFoot} style={{ display: 'grid', gap: '0.5rem' }}>
            <UserBox after="/merchant/login" />
            <span>
              Shopping as a buyer? <Link href="/buyer">Open the buyer view</Link>
            </span>
          </div>
        </aside>
        <div className={u.main}>
              <main className={u.content}>
                {blocked ? (
                  <Notice tone="warn">
                    This area is for the store team. You are signed in with a buyer account.{' '}
                    <Link href="/buyer">Go to your shopping page</Link>
                  </Notice>
                ) : (
                  children
                )}
              </main>
        </div>
      </div>
    </div>
  );
}
