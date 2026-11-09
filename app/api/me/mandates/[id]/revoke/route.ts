import { audit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import { apiError } from '@/lib/http';
import { listMyMandates, revokeMyMandate } from '@/lib/myData';

export const runtime = 'nodejs';

// POST -> MyMandate. The buyer withdraws their own mandate: the agent can no longer shop on it and no new order can be
// placed with it. Orders already paid are not affected. 404 when it is not this buyer's mandate.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'shop');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const changed = await revokeMyMandate(authz.user.id, id);
  if (changed === undefined) return apiError(404, 'mandate_not_found', `No mandate with id ${id}.`);
  if (changed) await audit(authz.user, { action: 'mandate.revoke', targetType: 'mandate', targetId: id });

  const mine = (await listMyMandates(authz.user.id)).find((m) => m.mandate_id === id);
  return Response.json(mine);
}
