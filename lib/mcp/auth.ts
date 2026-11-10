import { apiError } from '../http';
import { can } from '../auth/roles';
import { findUserByKey, type KeyUser } from './keys';

/** The caller of an MCP request: a buyer's agent key in "Authorization: Bearer <key>". 401 without a valid key. */
export async function requireApiKey(req: Request): Promise<{ ok: true; user: KeyUser } | { ok: false; response: Response }> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const user = token ? await findUserByKey(token) : null;
  if (!user) {
    const res = apiError(401, 'invalid_key', 'Send a valid agent key as "Authorization: Bearer <key>". Create one on your MandatePay account page.');
    res.headers.set('www-authenticate', 'Bearer realm="mandatepay"');
    return { ok: false, response: res };
  }
  if (!can(user.role, 'shop')) return { ok: false, response: apiError(403, 'forbidden', 'This account cannot shop.') };
  return { ok: true, user };
}
