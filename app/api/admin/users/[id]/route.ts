import { UpdateUserRequest } from '@/contracts/schemas';
import { countOwners, findAccount, setDisabled, setRole } from '@/lib/accounts';
import { audit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import { roleChangeProblem } from '@/lib/auth/team';
import { apiError } from '@/lib/http';

export const runtime = 'nodejs';

// PATCH UpdateUserRequest -> AccountSummary. Change a role and/or disable sign-in. Admin only.
// Disabling ends the person's sessions at once. Nobody can disable or re-role themselves.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'users:manage');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const body = UpdateUserRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { role?, disabled? }.', body.error.issues);

  const target = await findAccount({ id });
  if (!target) return apiError(404, 'account_not_found', `No account with id ${id}.`);

  if (body.data.role !== undefined && body.data.role !== target.role) {
    const problem = roleChangeProblem({
      actorId: authz.user.id,
      actorRole: authz.user.role,
      targetId: target.id,
      targetRole: target.role,
      newRole: body.data.role,
      ownerCount: await countOwners(),
    });
    if (problem) return apiError(409, 'role_change_refused', problem);
    await setRole(target.id, body.data.role);
    await audit(authz.user, {
      action: 'user.role',
      targetType: 'user',
      targetId: target.id,
      details: { email: target.email, from: target.role, to: body.data.role },
    });
  }

  if (body.data.disabled !== undefined && body.data.disabled !== target.disabled) {
    if (target.id === authz.user.id) return apiError(409, 'cannot_disable_self', 'You cannot disable your own account.');
    await setDisabled(target.id, body.data.disabled);
    await audit(authz.user, {
      action: body.data.disabled ? 'user.disable' : 'user.enable',
      targetType: 'user',
      targetId: target.id,
      details: { email: target.email },
    });
  }
  return Response.json(await findAccount({ id }));
}
