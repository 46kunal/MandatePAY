import { SetTeamRoleRequest, type ListTeamResponse } from '@/contracts/schemas';
import { countOwners, findAccount, listAccounts, setRole } from '@/lib/accounts';
import { audit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import { roleChangeProblem, TEAM_ROLES } from '@/lib/auth/team';
import { apiError } from '@/lib/http';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> ListTeamResponse: everyone with a store-team role (staff, owner, admin).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'settings:read');
  if (!authz.ok) return authz.response;
  const body: z.infer<typeof ListTeamResponse> = { members: await listAccounts({ roles: TEAM_ROLES }) };
  return Response.json(body);
}

// POST SetTeamRoleRequest -> AccountSummary. Gives an existing account a role (buyer removes them from the team).
// 404 no account with that email (they sign up at /login first), 409 when the rules forbid the change.
export async function POST(req: Request) {
  const authz = await requirePermission(req, 'team:manage');
  if (!authz.ok) return authz.response;
  const body = SetTeamRoleRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Expected { email, role }.', body.error.issues);

  const target = await findAccount({ email: body.data.email });
  if (!target) {
    return apiError(404, 'account_not_found', 'No account with that email. Ask them to create one at /login first.');
  }
  if (target.role === body.data.role) return Response.json(target);

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
  return Response.json(await findAccount({ id: target.id }));
}
