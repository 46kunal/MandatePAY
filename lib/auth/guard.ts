/**
 * Route guard (owner: orchestrator). Every protected API route starts with:
 *
 *   const authz = await requirePermission(req, 'cases:read');
 *   if (!authz.ok) return authz.response;
 *
 * The session is checked on the server for each request; the proxy's redirect is only a convenience.
 * 401 when nobody is signed in, 403 when the signed-in role lacks the permission.
 */
import { apiError } from '../http';
import { can, type Permission } from './roles';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export type Authz = { ok: true; user: SessionUser } | { ok: false; response: Response };

/** Pure decision, unit-tested. */
export function authorize(user: SessionUser | null | undefined, permission: Permission): Authz {
  if (!user) return { ok: false, response: apiError(401, 'unauthenticated', 'Sign in to continue.') };
  if (!can(user.role, permission)) {
    return { ok: false, response: apiError(403, 'forbidden', 'Your account is not allowed to do this.', { permission }) };
  }
  return { ok: true, user };
}

/** The signed-in user for this request, or null. */
export async function sessionUser(headers: Headers): Promise<SessionUser | null> {
  const { auth } = await import('./server');
  const s = await auth.api.getSession({ headers });
  if (!s?.user) return null;
  const u = s.user as { id: string; email: string; name: string; role?: string | null; disabledAt?: Date | string | null };
  if (u.disabledAt) return null; // disabled after this session started
  return { id: u.id, email: u.email, name: u.name, role: u.role ?? 'buyer' };
}

export async function requirePermission(req: Request, permission: Permission): Promise<Authz> {
  return authorize(await sessionUser(req.headers), permission);
}
