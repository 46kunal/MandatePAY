/**
 * Rules for changing someone's role (owner: orchestrator). Pure, so the rules are unit-tested; the API routes load
 * the facts and apply the answer.
 */
import { can, isRole, type Role } from './roles';

export interface RoleChange {
  actorId: string;
  actorRole: string;
  targetId: string;
  targetRole: string;
  newRole: string;
  /** Owners in the store right now, the target included. */
  ownerCount: number;
}

/** null when allowed, otherwise the reason to show. */
export function roleChangeProblem(c: RoleChange): string | null {
  if (!isRole(c.newRole)) return 'Unknown role.';
  if (!can(c.actorRole, 'team:manage')) return 'Your account cannot change roles.';
  if (c.actorId === c.targetId) return 'You cannot change your own role. Ask another owner or an admin.';
  const adminInvolved = c.newRole === 'admin' || c.targetRole === 'admin';
  if (adminInvolved && !can(c.actorRole, 'users:manage')) return 'Only an admin can give or take the admin role.';
  if (c.targetRole === 'owner' && c.newRole !== 'owner' && c.ownerCount <= 1) {
    return 'This is the only owner. Make someone else owner first.';
  }
  return null;
}

/** Roles shown in the team list. */
export const TEAM_ROLES: readonly Role[] = ['staff', 'owner', 'admin'];
