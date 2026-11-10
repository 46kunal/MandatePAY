import { z } from 'zod';
import { audit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import { apiError } from '@/lib/http';
import { createApiKey, listApiKeys } from '@/lib/mcp/keys';
import { limited } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ name: z.string().trim().min(1).max(60) }).strict();

// GET -> { keys: ApiKeyView[] }: the signed-in buyer's agent keys (never the keys themselves).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  return Response.json({ keys: await listApiKeys(authz.user.id) });
}

// POST { name } -> { key, ...ApiKeyView } (201). The key is shown once; only its hash is stored. At most 5 active keys.
export async function POST(req: Request) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const slow = limited(authz.user.id, 'key', 10);
  if (slow) return slow;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Give the key a short name, such as "My assistant".', body.error.issues);
  const active = (await listApiKeys(authz.user.id)).filter((k) => !k.revoked_at);
  if (active.length >= 5) return apiError(409, 'too_many_keys', 'You already have 5 active keys. Revoke one first.');
  const { key, view } = await createApiKey(authz.user.id, body.data.name);
  await audit(authz.user, { action: 'key.create', targetType: 'api_key', targetId: view.id });
  return Response.json({ key, ...view }, { status: 201 });
}
