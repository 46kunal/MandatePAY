/**
 * Roles and what each may do (owner: orchestrator). Pure: no database, no session, so it is unit-tested and shared
 * by API routes, pages and scripts. Every API route names the permission it needs; nothing checks role names directly.
 *
 *  buyer  - signs mandates, shops, pays; sees only their own mandates, carts and orders.
 *  staff  - merchant team: disputes, orders, products. Cannot change settings or approve human-reviewed actions.
 *  owner  - staff, plus store settings and approving actions that need a person.
 *  admin  - everything, across the platform.
 * Any signed-in person may also shop for themselves (staff testing the buyer flow is normal).
 */
export const ROLES = ['buyer', 'staff', 'owner', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'shop', // draft and sign own mandates, run the agent, check own carts, pay own orders
  'products:read',
  'products:write',
  'orders:read:all',
  'cases:read', // disputes, evidence packs, the mandate ledger
  'cases:analyse',
  'cases:act', // send an action whose verdict needs no person
  'cases:approve', // send an action a person must approve, or override the AI
  'disputes:poll',
  'status:read',
  'settings:read',
  'settings:write',
  'team:manage', // give or take store-team roles (staff, owner) on existing accounts
  'audit:read',
  'users:manage', // every account: any role, disable sign-in
  'system:read', // system health
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF: readonly Permission[] = [
  'shop',
  'products:read',
  'products:write',
  'orders:read:all',
  'cases:read',
  'cases:analyse',
  'cases:act',
  'disputes:poll',
  'status:read',
  'settings:read',
];

const GRANTS: Record<Role, readonly Permission[]> = {
  buyer: ['shop', 'products:read'],
  staff: STAFF,
  owner: [...STAFF, 'cases:approve', 'settings:write', 'team:manage', 'audit:read'],
  admin: PERMISSIONS,
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Unknown or missing roles get nothing. */
export function can(role: unknown, permission: Permission): boolean {
  return isRole(role) && GRANTS[role].includes(permission);
}

/** Merchant-side people: they use the dashboard and sign in at /merchant/login. */
export function isMerchantRole(role: unknown): boolean {
  return role === 'staff' || role === 'owner' || role === 'admin';
}
