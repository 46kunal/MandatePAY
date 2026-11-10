/**
 * Which part of the app each role may open (owner: orchestrator). Pure, so it is unit-tested and shared by the
 * landing redirect and the page layouts. Buyers never see store pages and store staff never see the buyer pages;
 * owners and admins, who may do both, can open either.
 */
import { isMerchantRole } from './roles';

export type Area = 'buyer' | 'merchant' | 'admin';

/** The home page for a role. */
export function homeFor(role: unknown): string {
  return isMerchantRole(role) ? '/merchant' : '/buyer';
}

/** May this role open this area? Staff are store-only; owners and admins reach everything they are allowed. */
export function canOpen(role: unknown, area: Area): boolean {
  if (area === 'buyer') return role === 'buyer' || role === 'owner' || role === 'admin';
  if (area === 'merchant') return isMerchantRole(role);
  return role === 'admin';
}

/** After signing in: the page they asked for if their role may open it, else their home. Same-site paths only. */
export function landingFor(role: unknown, next: string | null | undefined): string {
  const safe = next && /^\/(?![/\\])/.test(next) ? next : null;
  if (!safe) return homeFor(role);
  const area: Area | null = safe.startsWith('/admin') ? 'admin' : safe.startsWith('/merchant') ? 'merchant' : safe.startsWith('/buyer') ? 'buyer' : null;
  if (area && !canOpen(role, area)) return homeFor(role);
  return safe;
}
