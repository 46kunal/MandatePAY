import type { ListUsersResponse } from '@/contracts/schemas';
import { listAccounts } from '@/lib/accounts';
import { requirePermission } from '@/lib/auth/guard';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?q= -> ListUsersResponse: every account (newest first, at most 200), searched by name or email. Admin only.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'users:manage');
  if (!authz.ok) return authz.response;
  const q = new URL(req.url).searchParams.get('q') ?? undefined;
  const body: z.infer<typeof ListUsersResponse> = { users: await listAccounts({ q }) };
  return Response.json(body);
}
