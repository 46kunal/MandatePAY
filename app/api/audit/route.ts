import type { ListAuditResponse } from '@/contracts/schemas';
import { listAudit } from '@/lib/audit';
import { requirePermission } from '@/lib/auth/guard';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?limit= -> ListAuditResponse, newest first (default 200, at most 1000). Owner and admin.
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'audit:read');
  if (!authz.ok) return authz.response;
  const limit = Number(new URL(req.url).searchParams.get('limit')) || 200;
  const body: z.infer<typeof ListAuditResponse> = { entries: await listAudit(limit) };
  return Response.json(body);
}
