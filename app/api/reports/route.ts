import type { ListReportsResponse } from '@/contracts/schemas';
import { requirePermission } from '@/lib/auth/guard';
import { listReports } from '@/lib/reports/reports';
import type { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET -> ListReportsResponse: every buyer problem report, open ones first. Store team (cases:read).
export async function GET(req: Request) {
  const authz = await requirePermission(req, 'cases:read');
  if (!authz.ok) return authz.response;
  const body: z.infer<typeof ListReportsResponse> = { reports: await listReports() };
  return Response.json(body);
}
