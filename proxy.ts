/**
 * Proxy (Next.js 16's name for middleware). A quick, optimistic check only: no session cookie on a buyer or merchant
 * page means "send to sign-in". It never decides what someone may see; every API route checks the session and role
 * on the server (lib/auth/guard.ts).
 */
import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === '/merchant/login') return NextResponse.next();
  if (getSessionCookie(req)) return NextResponse.next();

  const team = pathname.startsWith('/merchant') || pathname.startsWith('/admin');
  const login = new URL(team ? '/merchant/login' : '/login', req.url);
  login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/buyer/:path*', '/merchant/:path*', '/admin/:path*'],
};
