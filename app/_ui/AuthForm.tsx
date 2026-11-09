'use client';
// Sign-in and sign-up form shared by /login (buyers) and /merchant/login (store team).
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { isMerchantRole } from '@/lib/auth/roles';
import { Card, Notice } from './Ui';
import u from './ui.module.css';

/** Only same-site paths, so a crafted link cannot send someone to another site after signing in. */
function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

type Mode = 'sign-in' | 'sign-up';

export function AuthForm({ side }: { side: 'buyer' | 'merchant' }) {
  const router = useRouter();
  const params = useSearchParams();
  const home = side === 'merchant' ? '/merchant' : '/buyer';
  const next = safeNext(params.get('next'), home);

  const [mode, setMode] = useState<Mode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'sign-up'
          ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
          : await authClient.signIn.email({ email: email.trim(), password });
      if (res.error) {
        setError(res.error.message ?? 'That did not work. Check your details and try again.');
        return;
      }
      const role = (res.data?.user as { role?: string } | undefined)?.role;
      if (side === 'merchant' && !isMerchantRole(role)) {
        await authClient.signOut();
        setError('This is a buyer account. Store team accounts are created by the store owner.');
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = side === 'merchant' ? 'Store team sign-in' : mode === 'sign-up' ? 'Create your account' : 'Sign in';
  const subtitle =
    side === 'merchant'
      ? 'For the store owner and staff.'
      : mode === 'sign-up'
        ? 'Your mandates, carts and orders are kept under this account.'
        : 'Sign in to shop with your agent.';

  return (
    <div style={{ maxWidth: 420, margin: '8vh auto 0', padding: '0 16px', display: 'grid', gap: '1rem' }}>
      <Link href="/" className={u.brand}>
        <span className={u.brandMark} aria-hidden="true">
          M
        </span>
        MandatePay
      </Link>
      <Card title={title} subtitle={subtitle}>
        <form onSubmit={submit} style={{ display: 'grid', gap: '0.8rem' }}>
          {mode === 'sign-up' && (
            <div className={u.field}>
              <label htmlFor="auth-name">Name</label>
              <input id="auth-name" className={u.input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </div>
          )}
          <div className={u.field}>
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className={u.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className={u.field}>
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className={u.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              minLength={mode === 'sign-up' ? 10 : undefined}
              required
            />
            {mode === 'sign-up' && <span className={u.muted} style={{ fontSize: '0.85em' }}>At least 10 characters.</span>}
          </div>
          {error && (
            <Notice tone="bad" alert>
              {error}
            </Notice>
          )}
          <button className={u.btn} type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </Card>
      {side === 'buyer' ? (
        <p className={u.muted} style={{ textAlign: 'center', margin: 0 }}>
          {mode === 'sign-in' ? 'New here? ' : 'Already have an account? '}
          <button
            type="button"
            className={u.linkButton}
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
            }}
          >
            {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
          </button>
          {' · '}
          <Link href="/merchant/login">Store team sign-in</Link>
        </p>
      ) : (
        <p className={u.muted} style={{ textAlign: 'center', margin: 0 }}>
          Shopping? <Link href="/login">Buyer sign-in</Link>
        </p>
      )}
    </div>
  );
}
