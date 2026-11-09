import { UpdateStoreSettingsRequest } from '@/contracts/schemas';
import { apiError } from '@/lib/http';
import { getSettings, updateSettings } from '@/lib/settings';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: A. GET -> StoreSettings (environment defaults until something is saved).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'settings:read');
  if (!authz.ok) return authz.response;
  return Response.json(await getSettings());
}

// OWNER: A. PATCH UpdateStoreSettingsRequest -> StoreSettings. Any subset of fields; null clears a text field.
// Open until logins land in Phase 1; then only the store owner may call it.
export async function PATCH(req: Request) {
  const authz = await requirePermission(req, 'settings:write');
  if (!authz.ok) return authz.response;
  const body = UpdateStoreSettingsRequest.safeParse(await req.json().catch(() => null));
  if (!body.success) return apiError(400, 'invalid_request', 'Invalid settings', body.error.issues);
  return Response.json(await updateSettings(body.data));
}
