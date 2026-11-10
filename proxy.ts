/**
 * Proxy (Next.js 16's name for middleware). A quick, optimistic check only: no session cookie on a buyer or merchant
 * page means "send to sign-in". It never decides what someone may see; the page layouts redirect by role and every
 * API route checks the session and role on the server (lib/auth/guard.ts). There is one sign-in for everyone.
 */
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (getSessionCookie(req)) return NextResponse.next();

  const login = new URL('/login', req.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/buyer/:path*', '/merchant/:path*', '/admin/:path*', '/start'],
};
