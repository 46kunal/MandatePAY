import { audit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import { apiError } from '@/lib/http';
import { revokeApiKey } from '@/lib/mcp/keys';

export const runtime = 'nodejs';

// DELETE -> { id, revoked: true }. The agent using the key is cut off at once. 404 when it is not this buyer's key or
// is already revoked.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  if (!(await revokeApiKey(authz.user.id, id))) return apiError(404, 'key_not_found', 'No active key with that id.');
  await audit(authz.user, { action: 'key.revoke', targetType: 'api_key', targetId: id });
  return Response.json({ id, revoked: true });
}
