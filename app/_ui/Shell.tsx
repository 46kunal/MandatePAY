'use client';
// OWNER: C. Page frames: BuyerShell (top navigation) and MerchantShell (sidebar + top bar). The logo always goes to the
// person's own home, never back to the landing page, so there is no extra click to get back to work.
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CaseRecord, ProblemReport } from '@/contracts/schemas';
import { authClient, useSession } from '@/lib/auth/client';
import { canOpen } from '@/lib/auth/routes';
import { apiFetch } from './api';
import { Icon, type IconName } from './Icons';
import { needsReview } from './labels';
import s from './shell.module.css';
import u from './ui.module.css';

const ROLE_LABEL: Record<string, string> = { buyer: 'Buyer', staff: 'Staff', owner: 'Owner', admin: 'Admin' };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase();
}

function Brand({ href }: { href: string }) {
  return (
    <Link href={href} className={s.brand} aria-label="MandatePay home">
      <span className={s.mark} aria-hidden="true">
        M
      </span>
      <span className={s.brandText}>MandatePay</span>
    </Link>
  );
}

/** Avatar button with a small menu: who is signed in, shortcuts, sign out. */
function UserMenu({ links = [] }: { links?: { label: string; href: string; icon: IconName }[] }) {
  const { data } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!data?.user) return null;
  const role = (data.user as { role?: string }).role ?? 'buyer';
  return (
    <div className={s.menuWrap} ref={ref}>
      <button type="button" className={s.menuBtn} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className={s.avatar} aria-hidden="true">
          {initials(data.user.name)}
        </span>
        <span className={s.menuName}>
          <b>{data.user.name}</b>
          <span>{ROLE_LABEL[role] ?? role}</span>
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && (
        <div className={s.menuPanel} role="menu">
          <div className={s.menuHead}>
            <b>{data.user.name}</b>
            <span>{data.user.email}</span>
          </div>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={s.menuItem} role="menuitem" onClick={() => setOpen(false)}>
              <Icon name={l.icon} size={16} />
              {l.label}
            </Link>
          ))}
          <button
            type="button"
            className={s.menuItem}
            role="menuitem"
            onClick={async () => {
              await authClient.signOut();
              router.replace('/');
              router.refresh();
            }}
          >
            <Icon name="logout" size={16} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- buyer ----------

const BUYER_LINKS = [
  { href: '/buyer', label: 'Home', exact: true },
  { href: '/buyer/orders', label: 'My orders' },
  { href: '/buyer/account', label: 'Account' },
];

export function BuyerShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '';
  const { data } = useSession();
  const role = (data?.user as { role?: string } | undefined)?.role;
  return (
    <div className={`${u.root} ${s.buyer}`}>
      <header className={s.bar}>
        <div className={s.barInner}>
          <Brand href="/buyer" />
          <nav className={s.links} aria-label="Main">
            {BUYER_LINKS.map((l) => {
              const on = l.exact ? path === l.href : path === l.href || path.startsWith(l.href + '/');
              return (
                <Link key={l.href} href={l.href} className={`${s.link} ${on ? s.linkOn : ''}`} aria-current={on ? 'page' : undefined}>
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <Link href="/buyer/shop" className={s.cta}>
            <Icon name="bag" size={16} />
            New purchase
          </Link>
          <UserMenu
            links={[
              { label: 'My orders', href: '/buyer/orders', icon: 'receipt' },
              { label: 'Account', href: '/buyer/account', icon: 'user' },
              ...(canOpen(role, 'merchant') ? [{ label: 'Store dashboard', href: '/merchant', icon: 'store' as IconName }] : []),
            ]}
          />
        </div>
      </header>
      <main className={s.buyerPage}>{children}</main>
    </div>
  );
}

// ---------- store ----------

type NavItem = { href: string; label: string; icon: IconName; exact?: boolean; badge?: 'review' | 'reports' };
const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/merchant', label: 'Overview', icon: 'home', exact: true },
      { href: '/merchant/disputes', label: 'Disputes', icon: 'shield', badge: 'review' },
      { href: '/merchant/reports', label: 'Buyer reports', icon: 'inbox', badge: 'reports' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { href: '/merchant/orders', label: 'Orders', icon: 'receipt' },
      { href: '/merchant/products', label: 'Products', icon: 'box' },
    ],
  },
  {
    label: 'Records',
    items: [
      { href: '/merchant/ledger', label: 'Mandate ledger', icon: 'book' },
      { href: '/merchant/evidence', label: 'Evidence reports', icon: 'file' },
      { href: '/merchant/results', label: 'Results', icon: 'chart' },
    ],
  },
];

function isOn(path: string, n: { href: string; exact?: boolean }) {
  return n.exact ? path === n.href : path === n.href || path.startsWith(n.href + '/');
}

/** Counts for the sidebar badges and the store name. Quiet: a failure just shows no badge. */
function useShellInfo() {
  const [info, setInfo] = useState<{ review: number; reports: number; store: string | null }>({ review: 0, reports: 0, store: null });
  const path = usePathname();
  useEffect(() => {
    let live = true;
    (async () => {
      const [cases, reports, status] = await Promise.allSettled([
        apiFetch<CaseRecord[]>('/api/cases'),
        apiFetch<{ reports: ProblemReport[] }>('/api/reports'),
        apiFetch<{ merchant_name: string | null }>('/api/status'),
      ]);
      if (!live) return;
      setInfo({
        review: cases.status === 'fulfilled' ? cases.value.data.filter(needsReview).length : 0,
        reports: reports.status === 'fulfilled' ? reports.value.data.reports.filter((r) => r.status === 'open').length : 0,
        store: status.status === 'fulfilled' ? status.value.data.merchant_name : null,
      });
    })();
    return () => {
      live = false;
    };
    // Refresh the counts when the person moves to another page, so a handled item stops showing.
  }, [path]);
  return info;
}

export function MerchantShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? '';
  const { data } = useSession();
  const info = useShellInfo();
  const role = (data?.user as { role?: string } | undefined)?.role;
  const all = [...GROUPS.flatMap((g) => g.items), { href: '/merchant/settings', label: 'Settings' }, { href: '/admin', label: 'Admin' }];
  const here = all.filter((n) => isOn(path, n)).sort((a, b) => b.href.length - a.href.length)[0];
  const badge = (b?: 'review' | 'reports') => (b === 'review' ? info.review : b === 'reports' ? info.reports : 0);

  const link = (n: NavItem) => {
    const on = isOn(path, n);
    const count = badge(n.badge);
    return (
      <Link key={n.href} href={n.href} className={`${s.item} ${on ? s.itemOn : ''}`} aria-current={on ? 'page' : undefined}>
        <Icon name={n.icon} />
        {n.label}
        {count > 0 && (
          <span className={s.badge} aria-label={`${count} waiting`}>
            {count}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className={u.root}>
      <div className={s.app}>
        <aside className={s.sidebar}>
          <div className={s.sideBrand}>
            <Brand href="/merchant" />
          </div>
          <nav aria-label="Store" className={s.nav}>
            {GROUPS.map((g) => (
              <div key={g.label} className={s.group}>
                <div className={s.groupLabel}>{g.label}</div>
                {g.items.map(link)}
              </div>
            ))}
          </nav>
          <div className={s.sideFoot}>
            {link({ href: '/merchant/settings', label: 'Settings', icon: 'gear' })}
            {role === 'admin' && link({ href: '/admin', label: 'Admin', icon: 'lock' })}
          </div>
        </aside>
        <div className={s.main}>
          <div className={s.top}>
            <div className={s.crumbs}>
              {info.store && (
                <span className={s.storeChip}>
                  <Icon name="store" size={14} />
                  {info.store}
                </span>
              )}
              {here && <b>{here.label}</b>}
            </div>
            <UserMenu
              links={[
                { label: 'Settings', href: '/merchant/settings', icon: 'gear' },
                ...(canOpen(role, 'buyer') ? [{ label: 'Open the shopping view', href: '/buyer', icon: 'bag' as IconName }] : []),
              ]}
            />
          </div>
          <main className={s.page}>{children}</main>
        </div>
      </div>
    </div>
  );
}
