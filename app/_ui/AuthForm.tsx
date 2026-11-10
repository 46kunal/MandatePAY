'use client';
// The one sign-in and sign-up form. Everyone signs in here; /start sends each role to its own home, so nobody has to
// choose a buyer or a store login.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { Card, Notice } from './Ui';
import a from './auth.module.css';
import u from './ui.module.css';

/** After signing in, /start sends the person home (or to the page they asked for, if their role may open it). */
function startUrl(next: string | null): string {
  return next && /^\/(?![/\\])/.test(next) ? `/start?next=${encodeURIComponent(next)}` : '/start';
}

type Mode = 'sign-in' | 'sign-up';

/** Shown only once "Log in with PayPal" is turned on for the PayPal app (see docs/DEPLOY.md). */
const PAYPAL_LOGIN = process.env.NEXT_PUBLIC_PAYPAL_LOGIN_ENABLED === '1';

/** Better Auth's ?error= codes after a PayPal sign-in, in words. */
function paypalErrorText(code: string | null): string | null {
  if (!code) return null;
  if (code === 'unable_to_link_account' || code === 'account_not_linked') {
    return 'An account with this email already exists. Sign in with your password, then connect PayPal from your Account page.';
  }
  if (code === 'email_not_found') return 'PayPal did not share an email address, so no account could be created.';
  if (code === 'account_already_linked_to_different_user') return 'That PayPal account is already connected to another MandatePay account.';
  return 'PayPal sign-in did not finish. Try again, or sign in with your email.';
}

export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = startUrl(params.get('next'));

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => paypalErrorText(params.get('error')));

  async function continueWithPayPal() {
    setBusy(true);
    setError(null);
    const r = await authClient.signIn.social({ provider: 'paypal', callbackURL: next, errorCallbackURL: '/login' });
    // On success the browser is already on its way to PayPal.
    if (r?.error) {
      setError(r.error.message ?? 'Could not start PayPal sign-in.');
      setBusy(false);
    }
  }

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
      router.replace(next);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'sign-up' ? 'Create your account' : 'Sign in';
  const subtitle = mode === 'sign-up' ? 'It takes a minute. You can start right away.' : 'Sign in with your email and password.';

  return (
    <div className={a.page}>
      <aside className={a.brandSide} aria-hidden="true">
        <Link href="/" className={a.logo} tabIndex={-1}>
          <span className={a.mark}>M</span>
          MandatePay
        </Link>
        <div className={a.quote}>
          <h2>Let an AI shop for you, and keep the proof</h2>
          <p>Your limits are signed before anything is bought, and every purchase is checked against them.</p>
        </div>
        <span className={a.fine}>Runs on the PayPal sandbox. No real money moves.</span>
      </aside>
      <main className={a.formSide}>
        <div className={a.formWrap}>
          <Link href="/" className={a.mobileLogo}>
            <span className={a.mark} style={{ background: 'var(--ink)', color: '#f5f1e9' }}>
              M
            </span>
            MandatePay
          </Link>
          <div>
            <h1 className={a.title}>{title}</h1>
            <p className={a.sub}>{subtitle}</p>
          </div>
          <Card>
        {PAYPAL_LOGIN && (
          <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '1rem' }}>
            <button className={u.btn} type="button" onClick={continueWithPayPal} disabled={busy}>
              Continue with PayPal
            </button>
            <span className={u.muted} style={{ fontSize: '0.85em' }}>
              Links your PayPal account, so the payments you make can be matched to you.
            </span>
            <div className={u.muted} style={{ textAlign: 'center', fontSize: '0.85em' }}>
              or with email
            </div>
          </div>
        )}
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
          <p className={a.switch}>
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
          </p>
        </div>
      </main>
    </div>
  );
}
