import { apiError } from '@/lib/http';
import { getCaseDetail } from '@/lib/paypal/cases';
import { requirePermission } from '@/lib/auth/guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OWNER: A. GET -> CaseRecord plus the linked mandate, cart and order for the detail view. 404 unknown case.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const authz = await requirePermission(req, 'cases:read');
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;
  const detail = await getCaseDetail(id);
  if (!detail) return apiError(404, 'case_not_found', `No case with id ${id}.`);
  return Response.json(detail);
}
